import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

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
