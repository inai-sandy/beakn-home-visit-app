import { alias } from 'drizzle-orm/pg-core';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { loadCaptainCityIds } from '@/lib/captain/cities';
import { buildCaptainRequestVisibilityWhere } from '@/lib/captain/team-scope';
import { computePageRange, DEFAULT_PAGE_SIZE } from '@/lib/pagination';

// =============================================================================
// PR12 2026-05-26: captain finance dashboard queries
// =============================================================================
//
// Two financial axes per request:
//
//   Quotation Pipeline = quotation exists AND status = QUOTATION_GIVEN
//                        (seq 5). Captain treats this as "potential
//                        revenue not yet committed by the customer."
//
//   Order Book         = quotation exists AND status >= ORDER_CONFIRMED
//                        (seq 6 through 10). Customer signed off; the
//                        money WILL come.
//
// Both sets exclude cancelled requests. Quotation-less requests aren't
// in scope (no money figure yet). Voided payments are excluded from
// totals via payments.voided_at IS NULL.
//
// Captain scope follows the existing team-scope rule
// (lib/captain/team-scope.ts) — super_admin sees the unrestricted set.
//
// Outstanding can go NEGATIVE when refunds exceed inbound (customer
// has credit). The UI surfaces that as "credit owed" rather than
// flooring to 0.
// =============================================================================

const ORDER_BOOK_MIN_SEQ = 6; // ORDER_CONFIRMED and beyond
const QUOTATION_PIPELINE_SEQ = 5; // QUOTATION_GIVEN exactly

export type FinanceSection = 'all' | 'order_book' | 'pipeline';

export function parseFinanceSection(raw: unknown): FinanceSection {
  if (raw === 'order_book' || raw === 'pipeline') return raw;
  return 'all';
}

export interface FinanceSnapshot {
  orderBook: { totalPaise: number; count: number };
  pipeline: { totalPaise: number; count: number };
  /** Net inbound − net outbound on Order Book rows only (pipeline isn't
   *  paid yet by definition). Voided excluded. Can be > orderBook when
   *  refunds outpace inbound — surfaced as negative outstanding. */
  receivedPaise: number;
  /** Outstanding = orderBook − received. Can be negative ("credit owed"). */
  outstandingPaise: number;
}

export interface FinanceAgingBucket {
  key: 'zeroToSeven' | 'eightToThirty' | 'thirtyPlus';
  label: string;
  outstandingPaise: number;
  count: number;
}

export interface FinanceOrderRow {
  requestId: string;
  customerName: string;
  customerPhone: string;
  cityName: string;
  execName: string | null;
  execUserId: string | null;
  stageCode: string;
  stageName: string;
  sequenceNumber: number;
  orderValuePaise: number;
  receivedPaise: number;
  outstandingPaise: number;
  quotationSubmittedAt: Date;
  /** Days since quotation submitted, floor-rounded. */
  ageDays: number;
  /** Cancelled rows are never returned; cancelledAt always null. */
}

interface BaseFilters {
  captainUserId: string;
  isSuperAdmin: boolean;
  section?: FinanceSection;
  execFilter?: string;
  cityFilter?: string;
  search?: string;
}

interface ListFilters extends BaseFilters {
  page?: number;
  pageSize?: number;
}

// -----------------------------------------------------------------------------
// Shared predicate builder
// -----------------------------------------------------------------------------

async function resolveScope(
  captainUserId: string,
  isSuperAdmin: boolean,
) {
  if (isSuperAdmin) {
    return { allowed: true as const, cityIds: [] as string[] };
  }
  const cityIds = await loadCaptainCityIds(captainUserId);
  if (cityIds.length === 0) return { allowed: false as const };
  return { allowed: true as const, cityIds };
}

function buildScopePredicate(
  captainUserId: string,
  isSuperAdmin: boolean,
  cityIds: string[],
) {
  if (isSuperAdmin) return undefined;
  return buildCaptainRequestVisibilityWhere(captainUserId, {
    captainCityIds: cityIds,
  });
}

function sectionPredicate(section: FinanceSection) {
  if (section === 'order_book') {
    return gte(statusStages.sequenceNumber, ORDER_BOOK_MIN_SEQ);
  }
  if (section === 'pipeline') {
    return eq(statusStages.sequenceNumber, QUOTATION_PIPELINE_SEQ);
  }
  // 'all' = pipeline (5) + order book (6+) — i.e. quotation exists.
  return gte(statusStages.sequenceNumber, QUOTATION_PIPELINE_SEQ);
}

function searchPredicate(search: string | undefined) {
  if (!search || search.trim().length === 0) return undefined;
  const term = search.trim();
  const digits = term.replace(/\D/g, '');
  return sql`(LOWER(${visitRequests.customerName}) LIKE ${`%${term.toLowerCase()}%`}
    ${digits.length > 0 ? sql`OR ${visitRequests.customerPhone} LIKE ${`%${digits}%`}` : sql``})`;
}

// -----------------------------------------------------------------------------
// Snapshot — 4 hero tiles
// -----------------------------------------------------------------------------

export async function loadFinanceSnapshot(
  args: BaseFilters,
): Promise<FinanceSnapshot> {
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin);
  if (!scope.allowed) {
    return {
      orderBook: { totalPaise: 0, count: 0 },
      pipeline: { totalPaise: 0, count: 0 },
      receivedPaise: 0,
      outstandingPaise: 0,
    };
  }

  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
  );

  const where = and(
    isNull(visitRequests.cancelledAt),
    scopeWhere,
    args.execFilter
      ? eq(visitRequests.assignedExecUserId, args.execFilter)
      : undefined,
    args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
    searchPredicate(args.search),
    // Snapshot always reports both axes regardless of section — section
    // toggle only narrows the order list.
    gte(statusStages.sequenceNumber, QUOTATION_PIPELINE_SEQ),
  );

  const [aggRow] = await db
    .select({
      orderBookTotal: sql<number>`COALESCE(SUM(CASE WHEN ${statusStages.sequenceNumber} >= ${ORDER_BOOK_MIN_SEQ} THEN ${quotations.totalOrderValuePaise} ELSE 0 END), 0)::bigint`,
      orderBookCount: sql<number>`COUNT(*) FILTER (WHERE ${statusStages.sequenceNumber} >= ${ORDER_BOOK_MIN_SEQ})::int`,
      pipelineTotal: sql<number>`COALESCE(SUM(CASE WHEN ${statusStages.sequenceNumber} = ${QUOTATION_PIPELINE_SEQ} THEN ${quotations.totalOrderValuePaise} ELSE 0 END), 0)::bigint`,
      pipelineCount: sql<number>`COUNT(*) FILTER (WHERE ${statusStages.sequenceNumber} = ${QUOTATION_PIPELINE_SEQ})::int`,
    })
    .from(visitRequests)
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(where);

  // Net received on Order Book rows only. Sub-query joins payments to
  // each request and sums inbound minus outbound, ignoring voided.
  const [payRow] = await db
    .select({
      received: sql<number>`COALESCE(SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE -${payments.amountPaise} END), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(
      and(
        isNull(payments.voidedAt),
        isNull(visitRequests.cancelledAt),
        scopeWhere,
        args.execFilter
          ? eq(visitRequests.assignedExecUserId, args.execFilter)
          : undefined,
        args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
        gte(statusStages.sequenceNumber, ORDER_BOOK_MIN_SEQ),
      ),
    );

  const orderBookTotal = Number(aggRow?.orderBookTotal ?? 0);
  const pipelineTotal = Number(aggRow?.pipelineTotal ?? 0);
  const receivedPaise = Number(payRow?.received ?? 0);

  return {
    orderBook: {
      totalPaise: orderBookTotal,
      count: aggRow?.orderBookCount ?? 0,
    },
    pipeline: {
      totalPaise: pipelineTotal,
      count: aggRow?.pipelineCount ?? 0,
    },
    receivedPaise,
    outstandingPaise: orderBookTotal - receivedPaise,
  };
}

// -----------------------------------------------------------------------------
// Aging buckets — Order Book only (pipeline has no aging)
// -----------------------------------------------------------------------------

export async function loadFinanceAgingBuckets(
  args: BaseFilters,
): Promise<FinanceAgingBucket[]> {
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin);
  if (!scope.allowed) {
    return [
      { key: 'zeroToSeven', label: '0–7 days', outstandingPaise: 0, count: 0 },
      { key: 'eightToThirty', label: '8–30 days', outstandingPaise: 0, count: 0 },
      { key: 'thirtyPlus', label: '30+ days', outstandingPaise: 0, count: 0 },
    ];
  }

  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
  );

  // Per-request totals, then bucket in JS — keeps the SQL portable and
  // matches the pattern the existing PendingCollections card uses.
  const rows = await db
    .select({
      requestId: visitRequests.id,
      totalPaise: quotations.totalOrderValuePaise,
      submittedAt: quotations.submittedAt,
      paidPaise: sql<string>`COALESCE((
        SELECT SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE -${payments.amountPaise} END)::text
        FROM ${payments}
        WHERE ${payments.visitRequestId} = ${visitRequests.id}
          AND ${payments.voidedAt} IS NULL
      ), '0')`,
    })
    .from(visitRequests)
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(
      and(
        isNull(visitRequests.cancelledAt),
        scopeWhere,
        args.execFilter
          ? eq(visitRequests.assignedExecUserId, args.execFilter)
          : undefined,
        args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
        searchPredicate(args.search),
        gte(statusStages.sequenceNumber, ORDER_BOOK_MIN_SEQ),
      ),
    );

  let zeroToSeven = 0;
  let eightToThirty = 0;
  let thirtyPlus = 0;
  let cZero = 0;
  let cEight = 0;
  let cThirty = 0;
  const nowMs = Date.now();
  for (const r of rows) {
    const total = Number(r.totalPaise);
    const paid = Number(r.paidPaise ?? 0);
    const due = total - paid;
    if (due <= 0) continue;
    const ageDays = Math.floor(
      (nowMs - r.submittedAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (ageDays <= 7) {
      zeroToSeven += due;
      cZero += 1;
    } else if (ageDays <= 30) {
      eightToThirty += due;
      cEight += 1;
    } else {
      thirtyPlus += due;
      cThirty += 1;
    }
  }

  return [
    {
      key: 'zeroToSeven',
      label: '0–7 days',
      outstandingPaise: zeroToSeven,
      count: cZero,
    },
    {
      key: 'eightToThirty',
      label: '8–30 days',
      outstandingPaise: eightToThirty,
      count: cEight,
    },
    {
      key: 'thirtyPlus',
      label: '30+ days',
      outstandingPaise: thirtyPlus,
      count: cThirty,
    },
  ];
}

// -----------------------------------------------------------------------------
// Order list — paginated rows
// -----------------------------------------------------------------------------

export async function loadFinanceOrderList(
  args: ListFilters,
): Promise<{ rows: FinanceOrderRow[]; total: number; pageRange: ReturnType<typeof computePageRange> }> {
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin);
  if (!scope.allowed) {
    return {
      rows: [],
      total: 0,
      pageRange: computePageRange({ total: 0, page: 1 }),
    };
  }
  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
  );
  const sectionWhere = sectionPredicate(args.section ?? 'all');
  const execUser = alias(users, 'finance_exec_user');

  const baseWhere = and(
    isNull(visitRequests.cancelledAt),
    scopeWhere,
    sectionWhere,
    args.execFilter
      ? eq(visitRequests.assignedExecUserId, args.execFilter)
      : undefined,
    args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
    searchPredicate(args.search),
  );

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(baseWhere);

  const pageRange = computePageRange({
    total,
    page: args.page ?? 1,
    pageSize: args.pageSize ?? DEFAULT_PAGE_SIZE,
  });

  const rawRows = await db
    .select({
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      execName: execUser.fullName,
      execUserId: visitRequests.assignedExecUserId,
      stageCode: statusStages.code,
      stageName: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
      orderValuePaise: quotations.totalOrderValuePaise,
      quotationSubmittedAt: quotations.submittedAt,
      // Inline aggregate via correlated sub-query so the ORDER BY can
      // sort on `outstanding` without a GROUP BY across all columns.
      receivedPaise: sql<string>`COALESCE((
        SELECT SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE -${payments.amountPaise} END)::text
        FROM ${payments}
        WHERE ${payments.visitRequestId} = ${visitRequests.id}
          AND ${payments.voidedAt} IS NULL
      ), '0')`,
    })
    .from(visitRequests)
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .where(baseWhere)
    // Default sort: outstanding desc (money to chase first), then
    // oldest quotation first as a tie-breaker.
    .orderBy(
      desc(
        sql`${quotations.totalOrderValuePaise} - COALESCE((
          SELECT SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE -${payments.amountPaise} END)
          FROM ${payments}
          WHERE ${payments.visitRequestId} = ${visitRequests.id}
            AND ${payments.voidedAt} IS NULL
        ), 0)`,
      ),
      asc(quotations.submittedAt),
    )
    .limit(pageRange.pageSize)
    .offset(pageRange.offset);

  const nowMs = Date.now();
  const rows: FinanceOrderRow[] = rawRows.map((r) => {
    const order = Number(r.orderValuePaise);
    const received = Number(r.receivedPaise ?? 0);
    return {
      requestId: r.requestId,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      cityName: r.cityName,
      execName: r.execName,
      execUserId: r.execUserId,
      stageCode: r.stageCode,
      stageName: r.stageName,
      sequenceNumber: r.sequenceNumber,
      orderValuePaise: order,
      receivedPaise: received,
      outstandingPaise: order - received,
      quotationSubmittedAt: r.quotationSubmittedAt,
      ageDays: Math.floor(
        (nowMs - r.quotationSubmittedAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
    };
  });

  return { rows, total, pageRange };
}

// -----------------------------------------------------------------------------
// Team roster — drives the exec filter dropdown
// -----------------------------------------------------------------------------

export async function loadFinanceTeamRoster(
  captainUserId: string,
  isSuperAdmin: boolean,
): Promise<Array<{ userId: string; fullName: string }>> {
  if (isSuperAdmin) {
    // Admin sees every active exec across cities — small list in
    // practice; cap at 100 to avoid an unbounded dropdown.
    return db
      .select({ userId: salesExecutives.userId, fullName: users.fullName })
      .from(salesExecutives)
      .innerJoin(users, eq(users.id, salesExecutives.userId))
      .where(eq(users.isActive, true))
      .orderBy(asc(users.fullName))
      .limit(100);
  }
  return db
    .select({ userId: salesExecutives.userId, fullName: users.fullName })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));
}

// -----------------------------------------------------------------------------
// Payment calendar — PR13 (separate route, same lib)
// -----------------------------------------------------------------------------

export interface PaymentCalendarEvent {
  id: string;
  /** Payment.payment_date as YYYY-MM-DD; converted to noon IST on the
   *  consumer side for the CalendarClient. */
  paymentDateIso: string;
  /** Always positive on the wire; consumers display +/- based on direction. */
  amountPaise: number;
  direction: 'inbound' | 'outbound';
  customerName: string;
  requestId: string;
  execName: string | null;
  execUserId: string | null;
  mode: string;
}

export async function loadPaymentCalendarEvents(
  args: BaseFilters & { fromIso: string; toIso: string },
): Promise<PaymentCalendarEvent[]> {
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin);
  if (!scope.allowed) return [];

  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
  );
  const execUser = alias(users, 'pay_exec_user');

  const rows = await db
    .select({
      id: payments.id,
      paymentDate: payments.paymentDate,
      amountPaise: payments.amountPaise,
      direction: payments.direction,
      mode: payments.mode,
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      execName: execUser.fullName,
      execUserId: visitRequests.assignedExecUserId,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .where(
      and(
        isNull(payments.voidedAt),
        isNull(visitRequests.cancelledAt),
        scopeWhere,
        args.execFilter
          ? eq(visitRequests.assignedExecUserId, args.execFilter)
          : undefined,
        args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
        searchPredicate(args.search),
        gte(payments.paymentDate, args.fromIso),
        lte(payments.paymentDate, args.toIso),
      ),
    )
    .orderBy(asc(payments.paymentDate));

  return rows.map<PaymentCalendarEvent>((r) => ({
    id: r.id,
    paymentDateIso: r.paymentDate,
    amountPaise: r.amountPaise,
    direction: r.direction,
    customerName: r.customerName,
    requestId: r.requestId,
    execName: r.execName,
    execUserId: r.execUserId,
    mode: r.mode,
  }));
}

// Silence unused import lint if no consumer needs ne/inArray here.
void ne;
void inArray;
