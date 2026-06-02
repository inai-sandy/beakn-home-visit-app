import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';
import { visitRequests } from './visits';

export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'push',
  'whatsapp',
  'email',
  'discord',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
  'retrying',
]);

// Outbox/retry queue for async dispatch on external channels (push/whatsapp/email/discord).
// notification_rules + notification_log live in HVA-48 (notification engine).
export const notificationsQueue = pgTable(
  'notifications_queue',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    channel: notificationChannelEnum('channel').notNull(),
    // recipientUserId for in-app/push targeting; recipientAddress for raw phone/email/webhook URL.
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
    recipientAddress: text('recipient_address'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: notificationStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('notifications_queue_status_idx').on(table.status),
    index('notifications_queue_scheduled_idx').on(table.scheduledAt),
    index('notifications_queue_recipient_user_idx').on(table.recipientUserId),
    index('notifications_queue_event_type_idx').on(table.eventType),
  ],
);

// Per-user inbox surfaced by HVA-52 drawer.
// HVA-54: persisted browser Web Push subscriptions. One row per (user,
// endpoint). The cryptographic material (p256dh + auth) is needed by the
// web-push library to encrypt the push payload server-side.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('push_subscriptions_endpoint_unique').on(table.endpoint),
    index('push_subscriptions_user_idx').on(table.userId),
  ],
);

// 2026-05-30: per-user notification preference overrides.
// Row exists with enabled=false → user opted out; absence → use rule's default.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_preferences_unique').on(
      table.userId,
      table.eventType,
      table.channel,
    ),
    index('notification_preferences_user_idx').on(table.userId),
  ],
);

export const inAppNotifications = pgTable(
  'in_app_notifications',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body').notNull(),
    // App-relative URL the drawer deep-links to.
    linkUrl: text('link_url'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('in_app_notifications_user_idx').on(table.userId),
    // Composite index supports the common "unread for user X" query.
    index('in_app_notifications_user_read_idx').on(table.userId, table.readAt),
    index('in_app_notifications_created_idx').on(table.createdAt),
  ],
);

// HVA-48: notification rules. Admin-editable mapping from (event_type,
// channel, recipient_role) → enabled/disabled. The engine reads only
// enabled=true rows. UNIQUE constraint on (event_type, channel,
// recipient_role) lets seed scripts upsert idempotently.
//
// `template_key` is a future hook for admin-editable bodies — Phase 2
// composers live in code (lib/notifications/compose/*). When body
// composition moves to the DB, the column carries the template id.
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    channel: varchar('channel', { length: 20 }).notNull(),
    recipientRole: varchar('recipient_role', { length: 50 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    templateKey: varchar('template_key', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('idx_notification_rules_event_enabled').on(table.eventType, table.enabled),
    uniqueIndex('idx_notification_rules_unique').on(
      table.eventType,
      table.channel,
      table.recipientRole,
    ),
  ],
);

// =============================================================================
// Libromi webhook telemetry — every WhatsApp send + its lifecycle
// =============================================================================
//
// One row per template send. external_id is the Libromi `messageId`
// returned from the POST /messages call; wamid is Meta's
// `wamid.HBg...` value that arrives only with the first status webhook.
//
// Four timestamp columns track the lifecycle: sent_at (we got 201 from
// Libromi — set on insert), provider_sent_at (Libromi's `sent` status
// webhook fired), delivered_at (recipient's phone received it), read_at
// (recipient opened the chat). failed_at + failure_code + failure_reason
// capture the failure path (Meta error codes like 131026
// "Message undeliverable"). All four event columns are nullable +
// idempotent: webhook updates set them only if currently NULL.
//
// recipient_role + event_type + request_id are denormalised here so the
// admin observability surface (delivery rate per template / per event /
// per request) doesn't need joins back to notification_rules.
//
// Security: this table is ALSO the messageId allowlist that defends the
// webhook receiver against spoofing — events whose external_id isn't in
// this table get logged + dropped (no DB write). Combined with the
// long-random URL secret, that's enough defence absent Libromi-side
// signing.
export const whatsappDispatches = pgTable(
  'whatsapp_dispatches',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    // Libromi internal id from the send response (e.g. "76519521"). The
    // message_id_map in every status webhook keys wamid → this id, so
    // this is the join key for the receiver. UNIQUE.
    externalId: varchar('external_id', { length: 64 }).notNull(),
    // Meta's wamid from the first status event. NULL until the first
    // webhook arrives (cheap reads can branch on this to detect
    // queued-but-never-acked messages).
    wamid: varchar('wamid', { length: 128 }),
    recipientPhone: varchar('recipient_phone', { length: 20 }).notNull(),
    templateName: varchar('template_name', { length: 100 }).notNull(),
    // Original dispatch event_type (e.g. 'request.created'). Denormalised.
    eventType: varchar('event_type', { length: 100 }).notNull(),
    // Original notification_rules.recipient_role (customer / exec_assigned /
    // captain_owning_city / etc.). Denormalised.
    recipientRole: varchar('recipient_role', { length: 50 }).notNull(),
    // Cross-reference into the request lifecycle when applicable.
    // Nullable because some dispatches (e.g. cron.day_close_reminder) aren't
    // tied to a request.
    requestId: uuid('request_id').references(() => visitRequests.id, {
      onDelete: 'set null',
    }),
    // For internal templates, the resolved user (NULL for customer role).
    recipientUserId: uuid('recipient_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    providerSentAt: timestamp('provider_sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureCode: integer('failure_code'),
    failureReason: text('failure_reason'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('whatsapp_dispatches_external_id_unique').on(table.externalId),
    index('whatsapp_dispatches_wamid_idx').on(table.wamid),
    index('whatsapp_dispatches_recipient_phone_idx').on(table.recipientPhone),
    index('whatsapp_dispatches_request_id_idx').on(table.requestId),
    index('whatsapp_dispatches_recipient_user_idx').on(table.recipientUserId),
    index('whatsapp_dispatches_event_type_idx').on(table.eventType),
    index('whatsapp_dispatches_sent_at_idx').on(table.sentAt),
  ],
);
