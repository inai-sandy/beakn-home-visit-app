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

export const paymentModeEnum = pgEnum('payment_mode', [
  'Cash',
  'UPI',
  'Bank Transfer',
  'Cheque',
]);

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    // 1:1 with visit_requests per HVA-70 — UNIQUE FK.
    visitRequestId: uuid('visit_request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    // Manually entered by exec per HVA-70 (no Laravel API integration in v1).
    quotationNumber: varchar('quotation_number', { length: 100 }).notNull(),
    totalOrderValuePaise: bigint('total_order_value_paise', { mode: 'number' }).notNull(),
    submittedByUserId: uuid('submitted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
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
    amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
    paymentDate: date('payment_date').notNull(),
    mode: paymentModeEnum('mode').notNull(),
    // Required for all modes per HVA-70; "received in cash" is an accepted value for Cash.
    referenceNumber: text('reference_number').notNull(),
    recordedByUserId: uuid('recorded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    index('payments_visit_request_idx').on(table.visitRequestId),
    index('payments_payment_date_idx').on(table.paymentDate),
    index('payments_recorded_by_idx').on(table.recordedByUserId),
    index('payments_mode_idx').on(table.mode),
  ],
);
