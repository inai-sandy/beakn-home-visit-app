import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';
import { cities } from './org';

export const bhkEnum = pgEnum('bhk_type', ['1BHK', '2BHK', '3BHK', '4BHK', 'Others']);

export const cancellationActorEnum = pgEnum('cancellation_actor', [
  'customer',
  'exec',
  'captain',
  'admin',
]);

export const statusStages = pgTable(
  'status_stages',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('status_stages_code_unique').on(table.code),
    uniqueIndex('status_stages_sequence_unique').on(table.sequenceNumber),
  ],
);

export const visitRequests = pgTable(
  'visit_requests',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),

    customerName: varchar('customer_name', { length: 255 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 15 }).notNull(),
    customerEmail: varchar('customer_email', { length: 255 }),
    address: text('address').notNull(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    bhk: bhkEnum('bhk').notNull(),
    // Multi-select per HVA-33: Automation / Motorized Curtains / Complete Lighting / All of the above.
    interest: jsonb('interest').$type<string[]>().notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),

    trackingToken: varchar('tracking_token', { length: 32 }).notNull(),
    source: varchar('source', { length: 32 }).notNull().default('web'),

    statusStageId: uuid('status_stage_id')
      .notNull()
      .references(() => statusStages.id, { onDelete: 'restrict' }),

    assignedExecUserId: uuid('assigned_exec_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    assignedCaptainUserId: uuid('assigned_captain_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    visitScheduledAt: timestamp('visit_scheduled_at', { withTimezone: true }),
    rescheduleCount: integer('reschedule_count').notNull().default(0),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationActor: cancellationActorEnum('cancellation_actor'),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    cancellationReason: text('cancellation_reason'),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('visit_requests_tracking_token_unique').on(table.trackingToken),
    index('visit_requests_city_idx').on(table.cityId),
    index('visit_requests_status_idx').on(table.statusStageId),
    index('visit_requests_assigned_exec_idx').on(table.assignedExecUserId),
    index('visit_requests_assigned_captain_idx').on(table.assignedCaptainUserId),
    index('visit_requests_phone_idx').on(table.customerPhone),
    index('visit_requests_created_idx').on(table.createdAt),
    index('visit_requests_visit_scheduled_idx').on(table.visitScheduledAt),
  ],
);

export const requestStatusHistory = pgTable(
  'request_status_history',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    fromStatusStageId: uuid('from_status_stage_id').references(() => statusStages.id, {
      onDelete: 'restrict',
    }),
    toStatusStageId: uuid('to_status_stage_id')
      .notNull()
      .references(() => statusStages.id, { onDelete: 'restrict' }),
    sequenceNumber: integer('sequence_number').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('request_status_history_request_idx').on(table.requestId),
    index('request_status_history_changed_at_idx').on(table.changedAt),
    uniqueIndex('request_status_history_request_sequence_unique').on(
      table.requestId,
      table.sequenceNumber,
    ),
  ],
);

export const requestRescheduleHistory = pgTable(
  'request_reschedule_history',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    fromVisitScheduledAt: timestamp('from_visit_scheduled_at', { withTimezone: true }),
    toVisitScheduledAt: timestamp('to_visit_scheduled_at', { withTimezone: true }).notNull(),
    rescheduledByUserId: uuid('rescheduled_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // NEEDS_REVIEW: HVA-72 may require reason NOT NULL — keeping nullable until that issue's UI is built.
    reason: text('reason'),
    rescheduledAt: timestamp('rescheduled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('request_reschedule_history_request_idx').on(table.requestId),
    index('request_reschedule_history_rescheduled_at_idx').on(table.rescheduledAt),
  ],
);
