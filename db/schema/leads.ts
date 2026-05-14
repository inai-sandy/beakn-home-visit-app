import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';
import { cities } from './org';
import { bhkEnum, visitRequests } from './visits';

export const leadTypeEnum = pgEnum('lead_type', ['Customer', 'Business']);

export const businessTypes = pgTable(
  'business_types',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex('business_types_code_unique').on(table.code)],
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),

    type: leadTypeEnum('type').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    // firmName + businessTypeId are required for type=Business per HVA-73 (validated app-side).
    firmName: varchar('firm_name', { length: 255 }),
    businessTypeId: uuid('business_type_id').references(() => businessTypes.id, {
      onDelete: 'restrict',
    }),
    // bhk applies to type=Customer only (optional even then).
    bhk: bhkEnum('bhk'),

    phone: varchar('phone', { length: 15 }).notNull(),
    email: varchar('email', { length: 255 }),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    interest: jsonb('interest').$type<string[]>().notNull(),
    notes: text('notes'),

    capturedByUserId: uuid('captured_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    capturedDate: date('captured_date').notNull().defaultNow(),

    convertedToRequestId: uuid('converted_to_request_id').references(() => visitRequests.id, {
      onDelete: 'set null',
    }),

    ...timestamps(),
  },
  (table) => [
    index('leads_phone_idx').on(table.phone),
    index('leads_city_idx').on(table.cityId),
    index('leads_captured_by_idx').on(table.capturedByUserId),
    index('leads_captured_date_idx').on(table.capturedDate),
    index('leads_type_idx').on(table.type),
    index('leads_business_type_idx').on(table.businessTypeId),
  ],
);
