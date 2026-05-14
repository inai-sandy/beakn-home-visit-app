import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    name: varchar('name', { length: 100 }).notNull().unique(),
    state: varchar('state', { length: 100 }),
    captainUserId: uuid('captain_user_id').references(() => users.id, { onDelete: 'set null' }),
    discordWebhookUrl: text('discord_webhook_url'),
    captainRoutingEmail: varchar('captain_routing_email', { length: 255 }),
    otherRoutingEmail: varchar('other_routing_email', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [index('cities_captain_user_idx').on(table.captainUserId)],
);

export const captains = pgTable('captains', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  isUnavailable: boolean('is_unavailable').notNull().default(false),
  ...timestamps(),
});

export const salesExecutives = pgTable(
  'sales_executives',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    captainUserId: uuid('captain_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isUnavailable: boolean('is_unavailable').notNull().default(false),
    ...timestamps(),
  },
  (table) => [index('sales_executives_captain_user_idx').on(table.captainUserId)],
);
