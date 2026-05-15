import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Better-Auth verification tokens — used by the phone-number plugin's OTP
// flow (when enabled) and by the password-reset OTP flow.
//
// `identifier` holds the phone number (or email) being verified.
// `value` is the OTP code (or whatever short-lived token BA needs).
// `expiresAt` is how long the token is good for.
//
// Today the password-only login path doesn't touch this table; once OTP
// flows land (HVA-?? phone-OTP, HVA-27 forgot-password-via-call) this is
// where short-lived secrets live.
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('verifications_identifier_idx').on(table.identifier),
    index('verifications_expires_at_idx').on(table.expiresAt),
  ],
);
