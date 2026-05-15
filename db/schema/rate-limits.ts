import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Better-Auth's rate-limit storage. Required when auth.ts sets
// `rateLimit.storage: "database"` (which we do — outside the HVA-10 stack
// we don't have Redis).
//
// Schema mirrors BA's expected shape: id, key (e.g. "/sign-in/phone-number:+91…"),
// count, lastRequest. `lastRequest` is a Unix-epoch number per BA's
// rateLimitSchema (z.ZodNumber), stored as bigint for safety.
//
// `key` is the only UNIQUE we enforce — BA does its own per-key
// increment/expiration logic.
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    key: text('key').notNull(),
    count: integer('count').notNull().default(0),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [index('rate_limits_key_idx').on(table.key)],
);

// HVA-34: customer-form anti-spam rate limit. Distinct from rate_limits
// (Better-Auth's per-key counter) because the model is different:
//   - rate_limits is a single row per key with an incrementing counter
//     (BA manages window logic in app code).
//   - rate_limit_attempts is row-per-attempt with attempted_at, so we
//     can use a simple windowed COUNT(*) query (no app-side bookkeeping).
//
// Cleanup runs in the same transaction as each insert: DELETE WHERE
// attempted_at < now() - interval '24 hours'. Cheap (indexed scan +
// targeted deletes) and idempotent.
export const rateLimitAttempts = pgTable(
  'rate_limit_attempts',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    // e.g. "request_submit:31.97.226.201". Caller decides the prefix.
    key: text('key').notNull(),
    // IPv4 or IPv6 string, captured from x-forwarded-for. Stored alongside
    // `key` even though the IP is embedded in the key, for forensic
    // queries that group by IP.
    ipAddress: text('ip_address').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('rate_limit_attempts_key_attempted_at_idx').on(
      table.key,
      table.attemptedAt,
    ),
  ],
);
