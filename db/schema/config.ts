import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';

// Single-row key/value store per HVA-17. Categories per spec §9.2:
// organization | workflow | targets | ai | notifications | audit.
export const config = pgTable(
  'config',
  {
    key: varchar('key', { length: 100 }).primaryKey(),
    value: jsonb('value').$type<unknown>().notNull(),
    // NEEDS_REVIEW: valueType inferred (string/number/boolean/object/array) — drop if app-side TS types are enough.
    valueType: varchar('value_type', { length: 32 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    description: text('description'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('config_category_idx').on(table.category)],
);

// Per HVA-93 + spec §9.2 Holidays. appliesToCityIds = null means "all cities".
export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    name: varchar('name', { length: 255 }).notNull(),
    startDate: date('start_date').notNull(),
    // Equals startDate for single-day holidays; bulk-add can produce multi-day ranges.
    endDate: date('end_date').notNull(),
    // NEEDS_REVIEW: JSONB array of city UUIDs loses per-id FK integrity vs a holidays_cities junction table.
    // Acceptable for v1 (read-mostly admin config); revisit if integrity matters.
    appliesToCityIds: jsonb('applies_to_city_ids').$type<string[] | null>(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('holidays_start_date_idx').on(table.startDate),
    index('holidays_end_date_idx').on(table.endDate),
    index('holidays_is_active_idx').on(table.isActive),
  ],
);
