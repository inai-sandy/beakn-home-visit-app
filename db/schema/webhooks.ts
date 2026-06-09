import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

// =============================================================================
// HVA-248 (HVA-230): webhook receivers — idempotency log + rotatable secrets
// =============================================================================
//
// webhookEvents = full audit + dead-letter store for every webhook received.
// One row per (provider, envelope-id). UNIQUE on (provider, provider_event_id)
// gives us free idempotency at the DB layer.
//
// webhookSecrets = HMAC signing keys, rotatable. Plaintext stored because
// HMAC-SHA256 verification requires the actual secret value; access gated to
// super_admin in the UI + server actions.
// =============================================================================

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    provider: varchar('provider', { length: 50 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    deliveryId: varchar('delivery_id', { length: 255 }),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    result: varchar('result', { length: 20 }),
    errorMessage: text('error_message'),
  },
  (table) => [
    uniqueIndex('webhook_events_provider_event_id_unique').on(
      table.provider,
      table.providerEventId,
    ),
    index('webhook_events_received_at_idx').on(table.receivedAt),
    index('webhook_events_event_type_idx').on(table.eventType),
    check(
      'webhook_events_result_check',
      sql`${table.result} IN ('ok','noop','error') OR ${table.result} IS NULL`,
    ),
  ],
);

export const webhookSecrets = pgTable(
  'webhook_secrets',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    provider: varchar('provider', { length: 50 }).notNull(),
    // Plaintext signing secret. HMAC-SHA256 verification needs the actual
    // value; hashing it would make verification impossible. super_admin-only
    // read access via server actions.
    secret: text('secret').notNull(),
    // First 4 + ellipsis + last 4 of the secret. Shown in admin lists so
    // operators can correlate without revealing the full value.
    secretPreview: varchar('secret_preview', { length: 20 }).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-revoke — the row stays for audit. Active = revokedAt IS NULL.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    // HVA-259: partial index — matches migration 0068 (WHERE revoked_at
    // IS NULL); the Drizzle definition previously omitted the WHERE.
    index('webhook_secrets_active_idx')
      .on(table.provider)
      .where(sql`${table.revokedAt} IS NULL`),
    index('webhook_secrets_created_at_idx').on(table.provider, table.createdAt),
  ],
);
