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
    // HVA-33: GPS accuracy in metres reported by the browser's
    // Geolocation API (HVA-32). Nullable — customers who don't share
    // location have NULL for all three GPS columns. Forensically
    // valuable: distinguishes coords accurate to ±5m from coords
    // accurate to ±5km when the team plans visits.
    locationAccuracy: numeric('location_accuracy', { precision: 10, scale: 2 }),

    // HVA-33: free-text state captured directly from the form. Form
    // auto-fills this from the selected city (CITY_TO_STATE map in
    // lib/validators/customer-request.ts) but lets the user edit
    // afterwards. Nullable so future seed/synthetic inserts that
    // skip this field don't break. For the 8 seeded cities this is
    // typically the canonical cities.state value; "Other" city
    // customers type their own state here (otherwise we'd lose the
    // signal entirely, since cities.state for the "Other" row is
    // NULL).
    customerState: varchar('customer_state', { length: 100 }),

    trackingToken: varchar('tracking_token', { length: 32 }).notNull(),
    source: varchar('source', { length: 32 }).notNull().default('web'),

    // HVA-73 PR 1: the contact (leads.id) this request was created from.
    // Nullable: requests created via the public customer-request form are
    // contact-less; only lead-conversion-created requests carry one. A
    // single contact may have multiple requests (interior designer with
    // repeat orders).
    //
    // We intentionally DO NOT declare `.references(() => leads.id)` here:
    // leads.ts already imports `visitRequests` for its
    // `converted_to_request_id` FK, and declaring the reverse direction
    // creates a circular module-level type cycle that TS can't infer
    // through. The FK is fully expressed in migration 0023 — the runtime
    // constraint, ON DELETE SET NULL behaviour, and the index all live
    // there.
    contactId: uuid('contact_id'),

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
    // HVA-69 repurposes this column as the optional free-text note.
    // The typed enum reason value lives in cancellationReasonCode below.
    cancellationReason: text('cancellation_reason'),
    // HVA-69: enum-value identifier for the reason
    // (see lib/rejection-reasons.ts). Length 64 leaves headroom for any
    // future taxonomy expansion without another migration.
    cancellationReasonCode: varchar('cancellation_reason_code', { length: 64 }),

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
    // HVA-73 PR 1: drives "all requests for this contact" on /leads/[id].
    index('visit_requests_contact_idx').on(table.contactId),
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
    // HVA-141 split: sequence_number stays as the target stage's seq for
    // human-readable filters; transition_order is the monotonic per-request
    // counter that carries the UNIQUE so backward transitions (rollback)
    // don't collide with the original forward row at the same stage seq.
    sequenceNumber: integer('sequence_number').notNull(),
    transitionOrder: integer('transition_order').notNull(),
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
    // HVA-141: UNIQUE moved to transition_order; the old
    // (request_id, sequence_number) unique is dropped in 0013.
    uniqueIndex('request_status_history_request_transition_order_unique').on(
      table.requestId,
      table.transitionOrder,
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
    // DEFERRED to HVA-72: NOT NULL decision waits for the reschedule form's required-field validation.
    reason: text('reason'),
    rescheduledAt: timestamp('rescheduled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('request_reschedule_history_request_idx').on(table.requestId),
    index('request_reschedule_history_rescheduled_at_idx').on(table.rescheduledAt),
  ],
);

// HVA-140: captain-driven exec reassignment trail. Distinct from
// request_status_history because reassignment does NOT change
// status_stage_id — the flow continues from where the previous exec
// left it. Schema in migration 0016.
export const requestExecAssignments = pgTable(
  'request_exec_assignments',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    fromExecUserId: uuid('from_exec_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    toExecUserId: uuid('to_exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    captainUserId: uuid('captain_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_request_exec_assignments_request_created').on(
      table.requestId,
      table.createdAt,
    ),
  ],
);
