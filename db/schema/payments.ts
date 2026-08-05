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
// webhooks.ts imports only auth.ts, so this direction introduces no cycle.
import { webhookEvents } from './webhooks';

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
    // HVA-296: CartPlus money breakdown. Null when not supplied (manual
    // quotations, older portal payloads). total_order_value_paise stays the
    // authoritative grand total = subtotal − discount + delivery + tax.
    subtotalPaise: bigint('subtotal_paise', { mode: 'number' }),
    discountPaise: bigint('discount_paise', { mode: 'number' }),
    deliveryPaise: bigint('delivery_paise', { mode: 'number' }),
    taxPaise: bigint('tax_paise', { mode: 'number' }),
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
    // HVA-248 (HVA-230): records CartPlus's `store.id` at creation time
    // so the trail survives even if cities↔store mapping changes later.
    // Only populated when source='portal'.
    storeId: bigint('store_id', { mode: 'number' }),
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
    // HVA-248 (HVA-230): CartPlus product ID + line item ID — used by the
    // webhook handler to upsert items on order.status_changed revisions.
    // NULL for manual entries.
    portalProductId: bigint('portal_product_id', { mode: 'number' }),
    portalLineItemId: bigint('portal_line_item_id', { mode: 'number' }),
    // HVA-280: soft-removal. When a CartPlus edit drops an item, the
    // sync sets this instead of hard-deleting (no-deletes rule). All
    // reads of "current" line items filter `removed_at IS NULL`; a
    // re-added item clears it.
    removedAt: timestamp('removed_at', { withTimezone: true }),
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

// =============================================================================
// HVA-325: CartPlus order edits that landed after Order Confirmed
// =============================================================================
//
// Confirming an order in the portal locks nothing in CartPlus — Beakn makes
// no outbound calls — so the order stays editable there and every edit
// rewrites the quotation regardless of how far the request has travelled.
// Five production orders changed value mid-flight before this existed, one of
// them ₹4,174 → ₹8,354, with nothing on screen but a "last synced" timestamp.
//
// Deliberately NOT a request_status_history row. apply-status.ts sets a
// precedent for a from=to history row (used on cancel) and copying it would
// have been less code, but request_status_history is read by ~30 call sites —
// conversion metrics, leaderboards, target progress, lifecycle and geography
// reports, the customer /track ladder. Introducing a new row KIND into a
// table that many consumers infer meaning from is how a reporting bug ships
// unnoticed. The request timeline merges this in as a third source instead,
// which HVA-324's merged-and-sorted timeline already made easy.
//
// Append-only, per the project's no-deletes rule: a superseded change is
// history, not a mistake to erase.
export const requestOrderChanges = pgTable(
  'request_order_changes',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    visitRequestId: uuid('visit_request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    // Which delivery caused it. SET NULL rather than CASCADE: webhook_events
    // is prunable audit data, and losing it must not cost us the record of
    // the money changing.
    webhookEventId: uuid('webhook_event_id').references(() => webhookEvents.id, {
      onDelete: 'set null',
    }),

    // Both sides stored so a row reads on its own, without replaying every
    // earlier change to work out where the value came from.
    previousTotalPaise: bigint('previous_total_paise', {
      mode: 'number',
    }).notNull(),
    newTotalPaise: bigint('new_total_paise', { mode: 'number' }).notNull(),

    previousItemCount: integer('previous_item_count').notNull(),
    newItemCount: integer('new_item_count').notNull(),

    // All three can be non-zero for a single edit.
    itemsAdded: integer('items_added').notNull().default(0),
    itemsRemoved: integer('items_removed').notNull().default(0),
    itemsAmended: integer('items_amended').notNull().default(0),

    // Denormalised on purpose: the record exists to say what was true AT THE
    // TIME, and the request will have moved on before anyone reads it.
    stageCode: varchar('stage_code', { length: 64 }).notNull(),

    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('request_order_changes_request_idx').on(table.visitRequestId),
    index('request_order_changes_changed_at_idx').on(table.changedAt),
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

// HVA-304: 'delivered' records that the customer actually received the
// package, not merely that it left us. Added in migration 0084.
export const dispatchStageEnum = pgEnum('dispatch_stage', [
  'created',
  'packed',
  'handed_off',
  'delivered',
]);

export const dispatches = pgTable(
  'dispatches',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    dispatchedByUserId: uuid('dispatched_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    // HVA-303: courier details for this package. Plain text by design —
    // the team records who is carrying it and the tracking number, then
    // tracks manually on the courier's own site. Both nullable: a dispatch
    // can be recorded before the courier is booked, and the tracking number
    // is usually only known at handoff.
    courierName: text('courier_name'),
    trackingNumber: text('tracking_number'),
    ...timestamps(),
  },
  (table) => [
    index('dispatches_dispatched_by_idx').on(table.dispatchedByUserId),
    index('dispatches_created_at_idx').on(table.createdAt),
    index('dispatches_tracking_number_idx').on(table.trackingNumber),
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
