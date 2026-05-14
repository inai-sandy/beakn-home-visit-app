import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';

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
