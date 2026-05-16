import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
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
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('quotations_visit_request_unique').on(table.visitRequestId),
    index('quotations_submitted_by_idx').on(table.submittedByUserId),
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
