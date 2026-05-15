import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';

// Better-Auth credentials store. One row per (user, provider) pair. Today
// every user has exactly one row with providerId = "credential" carrying
// the argon2id-hashed password in the `password` column. Future OAuth
// providers (if any) would add more rows under different providerIds.
//
// accessToken / refreshToken / idToken / *ExpiresAt / scope are required
// columns even though we don't use them for credential auth — they're
// populated when an OAuth provider is added.
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    index('accounts_provider_account_idx').on(table.providerId, table.accountId),
  ],
);
