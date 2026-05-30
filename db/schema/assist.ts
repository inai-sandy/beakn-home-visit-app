// HVA-199: Assist section — exec material-request portal.
//
// `type` enum is single-valued today (`material_request`); future assist
// categories append. Server-action validator keeps the type immutable
// after create so a stray UPDATE can't reclassify an existing request.

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { visitRequests } from './visits';

export const assistTypeEnum = pgEnum('assist_type', ['material_request']);

export const assistStatusEnum = pgEnum('assist_status', [
  'submitted',
  'approved',
  'processing',
  'dispatched',
  'rejected',
]);

export const assistPriorityEnum = pgEnum('assist_priority', [
  'high',
  'medium',
  'low',
]);

export const assistRequests = pgTable(
  'assist_requests',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: assistTypeEnum('type').notNull().default('material_request'),
    status: assistStatusEnum('status').notNull().default('submitted'),
    orderNumber: text('order_number'),
    dispatchByDate: date('dispatch_by_date'),
    priority: assistPriorityEnum('priority').notNull().default('medium'),
    message: text('message'),
    linkedVisitRequestId: uuid('linked_visit_request_id').references(
      () => visitRequests.id,
      { onDelete: 'set null' },
    ),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assist_requests_exec_idx').on(table.execUserId),
    index('assist_requests_status_idx').on(table.status),
    index('assist_requests_type_idx').on(table.type),
    index('assist_requests_created_at_idx').on(table.createdAt),
  ],
);

export const assistRequestItems = pgTable(
  'assist_request_items',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    assistRequestId: uuid('assist_request_id')
      .notNull()
      .references(() => assistRequests.id, { onDelete: 'cascade' }),
    productName: text('product_name').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assist_request_items_request_idx').on(table.assistRequestId),
    check('assist_request_items_quantity_chk', sql`${table.quantity} > 0`),
  ],
);

export const assistRequestStatusHistory = pgTable(
  'assist_request_status_history',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    assistRequestId: uuid('assist_request_id')
      .notNull()
      .references(() => assistRequests.id, { onDelete: 'cascade' }),
    fromStatus: assistStatusEnum('from_status'),
    toStatus: assistStatusEnum('to_status').notNull(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('assist_request_status_history_request_idx').on(
      table.assistRequestId,
      table.changedAt,
    ),
  ],
);
