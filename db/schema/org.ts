import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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
    // BUG 8 2026-06-03: an exec belongs to ONE city. Previously each
    // exec was implicitly "in all of their captain's cities" via the
    // captain→cities 1:N relationship. Per-city admin tiles (exec
    // counts, city drill team list) need a direct exec→city link so
    // they don't over-count when a captain owns multiple cities.
    // Nullable on insert because backfill for multi-city captains
    // leaves the value NULL until admin assigns explicitly (UI banner
    // surfaces those). Required at the form layer for new execs.
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
    isUnavailable: boolean('is_unavailable').notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    index('sales_executives_captain_user_idx').on(table.captainUserId),
    index('sales_executives_city_idx').on(table.cityId),
  ],
);

// =============================================================================
// PR10 2026-05-26: scheduled exec unavailability
// =============================================================================
//
// Captain schedules vacation / half-day / weekly off windows ahead of
// time instead of flipping `is_unavailable` daily. Queries that need
// "available today?" must check BOTH the boolean flag and the schedule
// (resolved via lib/captain/availability.ts).
//
// The `reason` text is app-capped at 200 chars (no DB-side limit so a
// future longer note pattern doesn't need a migration).
// =============================================================================

export const execUnavailabilitySchedules = pgTable(
  'exec_unavailability_schedules',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    reason: text('reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (table) => [
    index('exec_unavailability_schedules_lookup_idx').on(
      table.execUserId,
      table.startDate,
      table.endDate,
    ),
    check(
      'exec_unavailability_schedules_dates_chk',
      sql`${table.startDate} <= ${table.endDate}`,
    ),
  ],
);
