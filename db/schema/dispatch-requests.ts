// HVA-342: exec material requests that point at real order line items.
//
// Replaces the free-text Assist tables (HVA-199, db/schema/assist.ts), where
// the requested product was a string somebody typed and approving a request
// shipped nothing. Here every requested product is a `quotation_line_items`
// row, so the request and the order cannot disagree.
//
// See db/migrations/0093_dispatch_requests.sql for the full reasoning,
// especially why the order group is its own table (partial approval).

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
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { dispatches, quotationLineItems } from './payments';
import { visitRequests } from './visits';

export const dispatchRequestStatusEnum = pgEnum('dispatch_request_status', [
  'open',
  'closed',
  'cancelled',
]);

export const dispatchRequestOrderStatusEnum = pgEnum(
  'dispatch_request_order_status',
  ['pending', 'approved', 'held', 'rejected'],
);

export const dispatchRequestPriorityEnum = pgEnum('dispatch_request_priority', [
  'high',
  'medium',
  'low',
]);

/** The header: who asked, how urgently, and by when they need it. */
export const dispatchRequests = pgTable(
  'dispatch_requests',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Rolled up from the order groups by the application — see
     *  `deriveRequestStatus` in lib/dispatch-requests/status.ts. Stored
     *  rather than derived on read so the exec's list can be paginated and
     *  filtered without loading every group. */
    status: dispatchRequestStatusEnum('status').notNull().default('open'),
    priority: dispatchRequestPriorityEnum('priority').notNull().default('medium'),
    requiredByDate: date('required_by_date'),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('dispatch_requests_exec_idx').on(table.execUserId, table.createdAt),
    index('dispatch_requests_status_idx').on(table.status, table.createdAt),
  ],
);

/**
 * One row per ORDER inside a request.
 *
 * This is the unit support decides on. A request spanning three customers'
 * orders becomes three groups, because a dispatch is one physical shipment
 * with one courier and cannot be shared between customers — and because
 * support needs to ship the one they have stock for without being forced to
 * reject the other two.
 */
export const dispatchRequestOrders = pgTable(
  'dispatch_request_orders',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    dispatchRequestId: uuid('dispatch_request_id')
      .notNull()
      .references(() => dispatchRequests.id, { onDelete: 'cascade' }),
    visitRequestId: uuid('visit_request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    status: dispatchRequestOrderStatusEnum('status')
      .notNull()
      .default('pending'),
    /** The dispatch this group produced. Non-null exactly when the group is
     *  approved — enforced by a CHECK, because an approved group with
     *  nothing behind it is precisely the bug this ticket exists to kill. */
    dispatchId: uuid('dispatch_id').references(() => dispatches.id, {
      onDelete: 'restrict',
    }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('dispatch_request_orders_unique').on(
      table.dispatchRequestId,
      table.visitRequestId,
    ),
    index('dispatch_request_orders_request_idx').on(table.dispatchRequestId),
    index('dispatch_request_orders_visit_request_idx').on(table.visitRequestId),
    index('dispatch_request_orders_status_idx').on(table.status),
    check(
      'dispatch_request_orders_approved_has_dispatch',
      sql`${table.status} <> 'approved' OR ${table.dispatchId} IS NOT NULL`,
    ),
  ],
);

/**
 * The products asked for, inside an order group.
 *
 * No product name, no price, no ordered quantity — all of that is read
 * through `quotationLineItemId`. Copying it is how the Assist table drifted.
 */
export const dispatchRequestItems = pgTable(
  'dispatch_request_items',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    dispatchRequestOrderId: uuid('dispatch_request_order_id')
      .notNull()
      .references(() => dispatchRequestOrders.id, { onDelete: 'cascade' }),
    quotationLineItemId: uuid('quotation_line_item_id')
      .notNull()
      .references(() => quotationLineItems.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    /** Set when the customer deleted this product in CartPlus after the exec
     *  asked for it. Kept rather than deleted: the exec was waiting on this
     *  and is owed an explanation, not a row that silently vanishes. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('dispatch_request_items_unique').on(
      table.dispatchRequestOrderId,
      table.quotationLineItemId,
    ),
    index('dispatch_request_items_order_idx').on(table.dispatchRequestOrderId),
    check('dispatch_request_items_quantity_chk', sql`${table.quantity} > 0`),
  ],
);
