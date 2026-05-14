import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
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
import { leads } from './leads';
import { visitRequests } from './visits';

export const taskTypeEnum = pgEnum('task_type', [
  'Outlet visit',
  'Customer home visit',
  'Sales pitch',
  'Follow-up',
  'Installation & Activation',
  'Stall Activity',
  'Other',
]);

export const taskStatusEnum = pgEnum('task_status', ['pending', 'completed', 'postponed', 'cancelled']);

export const outcomeOptions = pgTable(
  'outcome_options',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    // Scopes outcome list to a task type per spec §10.5.
    taskType: taskTypeEnum('task_type').notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('outcome_options_task_type_code_unique').on(table.taskType, table.code),
    index('outcome_options_task_type_idx').on(table.taskType),
  ],
);

export const postponeReasons = pgTable(
  'postpone_reasons',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sequenceNumber: integer('sequence_number').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex('postpone_reasons_code_unique').on(table.code)],
);

export const dayPlans = pgTable(
  'day_plans',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    planDate: date('plan_date').notNull(),

    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    scheduledVisitCount: integer('scheduled_visit_count').notNull().default(0),
    additionalTaskCount: integer('additional_task_count').notNull().default(0),
    isLate: boolean('is_late').notNull().default(false),

    // Day-close fields (§10.7). Null until the exec closes the day.
    closedAt: timestamp('closed_at', { withTimezone: true }),
    amountCollectedPaise: bigint('amount_collected_paise', { mode: 'number' }),
    quotationsSubmittedToday: integer('quotations_submitted_today'),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('day_plans_exec_date_unique').on(table.execUserId, table.planDate),
    index('day_plans_exec_idx').on(table.execUserId),
    index('day_plans_date_idx').on(table.planDate),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),

    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    dayPlanId: uuid('day_plan_id').references(() => dayPlans.id, { onDelete: 'set null' }),

    taskType: taskTypeEnum('task_type').notNull(),
    description: text('description').notNull(),
    // NEEDS_REVIEW: HVA-58 estimated_time enum values not yet pinned down (likely "15min" / "30min" / "1hr" / "2hr").
    // Using varchar(32) so values can be added without a migration; lock to pgEnum once HVA-58 is detailed.
    estimatedTime: varchar('estimated_time', { length: 32 }).notNull(),
    taskDate: date('task_date').notNull(),

    // Polymorphic link target: at most one of these is set (validated app-side).
    linkRequestId: uuid('link_request_id').references(() => visitRequests.id, {
      onDelete: 'set null',
    }),
    linkLeadId: uuid('link_lead_id').references(() => leads.id, { onDelete: 'set null' }),

    status: taskStatusEnum('status').notNull().default('pending'),

    // Completion fields (§10.5).
    outcomeOptionId: uuid('outcome_option_id').references(() => outcomeOptions.id, {
      onDelete: 'restrict',
    }),
    outcomeNotes: text('outcome_notes'),
    // NEEDS_REVIEW: actualTime mirrors estimatedTime's enum once finalised.
    actualTime: varchar('actual_time', { length: 32 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Postpone fields (§10.6).
    postponedToDate: date('postponed_to_date'),
    postponeReasonId: uuid('postpone_reason_id').references(() => postponeReasons.id, {
      onDelete: 'restrict',
    }),
    customerInformed: boolean('customer_informed'),

    ...timestamps(),
  },
  (table) => [
    index('tasks_exec_idx').on(table.execUserId),
    index('tasks_day_plan_idx').on(table.dayPlanId),
    index('tasks_task_date_idx').on(table.taskDate),
    index('tasks_status_idx').on(table.status),
    index('tasks_link_request_idx').on(table.linkRequestId),
    index('tasks_link_lead_idx').on(table.linkLeadId),
  ],
);
