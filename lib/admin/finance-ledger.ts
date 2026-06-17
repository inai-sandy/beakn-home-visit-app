import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities, payments, users, visitRequests } from '@/db/schema';

// =============================================================================
// HVA-297: admin finance — the payments ledger ("every financial record")
// =============================================================================
//
// Org-wide list of every non-voided payment (inbound + refunds) in a date
// window, joined to the customer / city / recorder. Powers the admin
// finance dashboard's record-level view + the Collected/Gross/Refunds tile
// drill-downs (?dir=inbound|outbound). payment_date is a plain date column,
// so the window compares directly (no IST cast).
// =============================================================================

export type LedgerDirection = 'inbound' | 'outbound';

export interface LedgerRow {
  id: string;
  paymentDate: string;
  direction: LedgerDirection;
  mode: string;
  amountPaise: number;
  customerName: string;
  cityName: string | null;
  recordedByName: string | null;
  referenceNumber: string | null;
  requestId: string;
}

export interface LedgerInput {
  fromDate: string;
  toDate: string;
  search: string;
  page: number;
  pageSize: number;
  direction?: LedgerDirection;
}

export interface LedgerResult {
  rows: LedgerRow[];
  total: number;
}

function ledgerFilters(i: Pick<LedgerInput, 'fromDate' | 'toDate' | 'search' | 'direction'>) {
  return and(
    isNull(payments.voidedAt),
    gte(payments.paymentDate, i.fromDate),
    lte(payments.paymentDate, i.toDate),
    i.direction ? eq(payments.direction, i.direction) : undefined,
    i.search
      ? or(
          ilike(visitRequests.customerName, `%${i.search}%`),
          ilike(visitRequests.customerPhone, `%${i.search}%`),
          ilike(payments.referenceNumber, `%${i.search}%`),
        )
      : undefined,
  );
}

export async function loadAdminPaymentsLedger(
  i: LedgerInput,
): Promise<LedgerResult> {
  const filters = ledgerFilters(i);

  const [countRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(filters);

  const rows = await db
    .select({
      id: payments.id,
      paymentDate: payments.paymentDate,
      direction: payments.direction,
      mode: payments.mode,
      amountPaise: payments.amountPaise,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      recordedByName: users.fullName,
      referenceNumber: payments.referenceNumber,
      requestId: payments.visitRequestId,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .leftJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(users, eq(users.id, payments.recordedByUserId))
    .where(filters)
    .orderBy(desc(payments.paymentDate), desc(payments.id))
    .limit(i.pageSize)
    .offset((i.page - 1) * i.pageSize);

  return {
    total: countRow?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      paymentDate: r.paymentDate,
      direction: r.direction as LedgerDirection,
      mode: r.mode,
      amountPaise: Number(r.amountPaise),
      customerName: r.customerName,
      cityName: r.cityName,
      recordedByName: r.recordedByName,
      referenceNumber: r.referenceNumber,
      requestId: r.requestId,
    })),
  };
}

export interface PaymentTotals {
  grossInboundPaise: number;
  refundsPaise: number;
  inboundCount: number;
  outboundCount: number;
}

/** Windowed cash totals for the flow tiles (gross in, refunds out). Net
 *  collected = gross − refunds; that net also = the SSOT `revenue` metric. */
export async function loadAdminPaymentTotals(opts: {
  fromDate: string;
  toDate: string;
}): Promise<PaymentTotals> {
  const rows = await db
    .select({
      direction: payments.direction,
      sum: sql<string>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(payments)
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, opts.fromDate),
        lte(payments.paymentDate, opts.toDate),
      ),
    )
    .groupBy(payments.direction);

  const totals: PaymentTotals = {
    grossInboundPaise: 0,
    refundsPaise: 0,
    inboundCount: 0,
    outboundCount: 0,
  };
  for (const r of rows) {
    if (r.direction === 'inbound') {
      totals.grossInboundPaise = Number(r.sum);
      totals.inboundCount = r.cnt;
    } else {
      totals.refundsPaise = Number(r.sum);
      totals.outboundCount = r.cnt;
    }
  }
  return totals;
}
