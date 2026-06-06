import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
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
import { visitRequests } from './visits';

// HVA-70 extends this enum with 'Card' + 'Other' via migration 0011.
// Title Case preserved to match HVA-14's original taxonomy.
export const paymentModeEnum = pgEnum('payment_mode', [
  'Cash',
  'UPI',
  'Bank Transfer',
  'Cheque',
  'Card',
  'Other',
]);

// HVA-70: inbound = customer paid us; outbound = refund to customer.
export const paymentDirectionEnum = pgEnum('payment_direction', [
  'inbound',
  'outbound',
]);

// HVA-234 (HVA-231 Phase 1.0): distinguishes manually-entered quotations
// (current path) from ones auto-created from the ECOM webhook (HVA-230).
// Both flows write to the same `quotations` table; this column lets us
// branch behavior + report on the split.
export const quotationSourceEnum = pgEnum('quotation_source', [
  'manual',
  'portal',
]);

// HVA-234: per-item priority set by the sales exec to drive support's
// dispatch queue sort order.
export const lineItemPriorityEnum = pgEnum('line_item_priority', [
  'low',
  'med',
  'high',
]);

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    // 1:1 with visit_requests per HVA-70 — UNIQUE FK.
    visitRequestId: uuid('visit_request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    // HVA-70 deviation: now nullable. Some quotations are recorded
    // without a formal external number.
    quotationNumber: varchar('quotation_number', { length: 100 }),
    totalOrderValuePaise: bigint('total_order_value_paise', { mode: 'number' }).notNull(),
    // HVA-70: free-text notes alongside the headline total.
    notes: text('notes'),
    submittedByUserId: uuid('submitted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    // HVA-70: who revised the quotation last (NULL until first revision).
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // HVA-234: source discriminator. 'manual' = exec entered via UI;
    // 'portal' = ECOM webhook auto-create. Affects audit copy + future
    // UI behavior (e.g., portal quotations are read-mostly).
    source: quotationSourceEnum('source').notNull().default('manual'),
    // HVA-234 (HVA-230): external portal's stable order ID. Used for
    // webhook idempotency — revisions of the same portal order land on
    // the same quotations row. NULL for manual quotations.
    // Partial UNIQUE index in migration 0063 enforces uniqueness when set.
    portalQuotationId: varchar('portal_quotation_id', { length: 64 }),
    // HVA-234 (HVA-230): last full webhook payload for audit + future
    // fields we haven't normalized yet. Only populated for source='portal'.
    rawPayload: jsonb('raw_payload'),
    // HVA-234 (HVA-230): timestamp of the most recent webhook delivery
    // that updated this row. Helps detect stale data / partner outages.
    lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('quotations_visit_request_unique').on(table.visitRequestId),
    index('quotations_submitted_by_idx').on(table.submittedByUserId),
  ],
);

// HVA-234: per-item rows under a quotation. 1:N with quotations,
// CASCADE delete since items have no identity outside their parent.
// Drives both:
//   - manual entry by execs (this ticket)
//   - portal auto-population by webhook handler (HVA-230)
//   - dispatch tracking by support team (HVA-231 Phase 1.1+)
export const quotationLineItems = pgTable(
  'quotation_line_items',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    // Display order within the quotation. Preserves row sequence even
    // after edits / inserts. Server assigns the next available position
    // on add; UI lets the user reorder later (TBD).
    position: integer('position').notNull(),
    productName: varchar('product_name', { length: 255 }).notNull(),
    productSku: varchar('product_sku', { length: 128 }),
    quantity: integer('quantity').notNull(),
    // HVA-convention: all money as paise integer.
    unitPricePaise: bigint('unit_price_paise', { mode: 'number' }).notNull(),
    lineTotalPaise: bigint('line_total_paise', { mode: 'number' }).notNull(),
    // GST percent stored when known (e.g., 18.00 for 18%). Optional —
    // partner may or may not emit per-line GST; manual flow rarely
    // captures it either.
    gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }),
    notes: text('notes'),
    // HVA-234: exec-controlled. Drives sort in the support queue.
    priority: lineItemPriorityEnum('priority').notNull().default('med'),
    // HVA-234: "by when does this item need to ship?" — exec sets, support reads.
    targetDispatchDate: date('target_dispatch_date'),
    ...timestamps(),
  },
  (table) => [
    index('quotation_line_items_quotation_idx').on(table.quotationId),
    index('quotation_line_items_priority_target_idx').on(
      table.priority,
      table.targetDispatchDate,
    ),
    index('quotation_line_items_sku_idx').on(table.productSku),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    visitRequestId: uuid('visit_request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'restrict' }),
    // HVA-70: amount is always positive; direction carries the sign for
    // summary math.
    direction: paymentDirectionEnum('direction').notNull().default('inbound'),
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    paymentDate: date('payment_date').notNull(),
    mode: paymentModeEnum('mode').notNull(),
    // HVA-70: free-text label distinct from reference_number. Required
    // for outbound (refund) entries — enforced server-side.
    label: varchar('label', { length: 255 }),
    // HVA-70 deviation: relaxed from NOT NULL so admins can record cash
    // without forcing a reference string.
    referenceNumber: text('reference_number'),
    notes: text('notes'),
    recordedByUserId: uuid('recorded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // HVA-70: void = "this payment never happened". Voided rows are
    // excluded from totals but kept for history. Captain/super_admin only.
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedByUserId: uuid('voided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    voidedReason: text('voided_reason'),
    ...timestamps(),
  },
  (table) => [
    index('payments_visit_request_idx').on(table.visitRequestId),
    index('payments_payment_date_idx').on(table.paymentDate),
    index('payments_recorded_by_idx').on(table.recordedByUserId),
    index('payments_mode_idx').on(table.mode),
    index('payments_direction_idx').on(table.direction),
  ],
);

// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): dispatch schema
// =============================================================================
//
// Three tables track the support team's dispatch lifecycle:
//   - dispatches: one row per dispatch event (a package leaving for the customer)
//   - dispatchItems: junction with quantity per line item in that dispatch
//   - dispatchStatusHistory: lifecycle audit per dispatch (created → packed → handed_off)
//
// Multi-order: one dispatch CAN include items from multiple visit_requests
// via the items junction. There is no direct FK from dispatches to a single
// request; the relationship is derived through dispatch_items →
// quotation_line_items → quotations → visit_requests.

export const dispatchStageEnum = pgEnum('dispatch_stage', [
  'created',
  'packed',
  'handed_off',
]);

export const dispatches = pgTable(
  'dispatches',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    dispatchedByUserId: uuid('dispatched_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (table) => [
    index('dispatches_dispatched_by_idx').on(table.dispatchedByUserId),
    index('dispatches_created_at_idx').on(table.createdAt),
  ],
);

export const dispatchItems = pgTable(
  'dispatch_items',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    dispatchId: uuid('dispatch_id')
      .notNull()
      .references(() => dispatches.id, { onDelete: 'cascade' }),
    quotationLineItemId: uuid('quotation_line_item_id')
      .notNull()
      .references(() => quotationLineItems.id, { onDelete: 'restrict' }),
    qtyInThisDispatch: integer('qty_in_this_dispatch').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('dispatch_items_dispatch_lineitem_unique').on(
      table.dispatchId,
      table.quotationLineItemId,
    ),
    index('dispatch_items_dispatch_idx').on(table.dispatchId),
    index('dispatch_items_lineitem_idx').on(table.quotationLineItemId),
  ],
);

export const dispatchStatusHistory = pgTable(
  'dispatch_status_history',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    dispatchId: uuid('dispatch_id')
      .notNull()
      .references(() => dispatches.id, { onDelete: 'cascade' }),
    stage: dispatchStageEnum('stage').notNull(),
    changedByUserId: uuid('changed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('dispatch_status_history_dispatch_stage_unique').on(
      table.dispatchId,
      table.stage,
    ),
    index('dispatch_status_history_dispatch_idx').on(
      table.dispatchId,
      table.changedAt,
    ),
  ],
);
