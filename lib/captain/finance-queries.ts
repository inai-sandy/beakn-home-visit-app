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
  lt,
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
// PR12 2026-05-26 (revised 2026-05-27): captain finance dashboard queries
// =============================================================================
//
// Two financial axes per request, both keyed by the EXISTENCE of a
// quotation row — not the status stage. The earlier scope (Pipeline =
// exact QUOTATION_GIVEN, Order Book = >= ORDER_CONFIRMED) silently
// dropped any quotation saved before the request had advanced past
// VISIT_SCHEDULED. Field reality: execs save the quotation at the
// customer's home before the system moves the stage forward, so a
// freshly-quoted ₹25,000 request at VISIT_SCHEDULED was invisible.
//
//   Quotation Pipeline = quotation exists AND sequence_number < 6
//                        (i.e. SUBMITTED..QUOTATION_GIVEN). "Money in
//                        motion, customer hasn't confirmed yet."
//
//   Order Book         = quotation exists AND sequence_number >= 6
//                        (ORDER_CONFIRMED..ORDER_EXECUTED_SUCCESSFULLY).
//                        "Customer confirmed; money is committed."
//
// Both sets exclude cancelled requests. Quotation-less requests aren't
// in scope (no money figure yet). Voided payments are excluded from
// totals via payments.voided_at IS NULL.
//
// Received counts ALL inbound − outbound payments on quoted requests
// regardless of stage. Field execs collect deposits against pre-
// confirmation quotes (₹5,000 against a ₹25,000 quote at
// VISIT_SCHEDULED, per the 2026-05-27 walk). Restricting Received to
// >= ORDER_CONFIRMED would hide those deposits.
//
// Outstanding = (Order Book + Pipeline) − Received. Can go negative
// when refunds exceed inbound (customer has credit). The UI surfaces
// that as "credit owed" rather than flooring to 0.
//
// Captain scope follows the existing team-scope rule
// (lib/captain/team-scope.ts) — super_admin sees the unrestricted set.
// =============================================================================

const ORDER_BOOK_MIN_SEQ = 6; // ORDER_CONFIRMED and beyond

export type FinanceSection = 'all' | 'order_book' | 'pipeline';

export function parseFinanceSection(raw: unknown): FinanceSection {
  if (raw === 'order_book' || raw === 'pipeline') return raw;
  return 'all';
}

export interface FinanceSnapshot {
  orderBook: { totalPaise: number; count: number };
  pipeline: { totalPaise: number; count: number };
  /** Net inbound − net outbound on ALL quoted requests (pipeline +
   *  order book), voided excluded. Pre-confirmation deposits count
   *  toward Received. Can exceed total quoted when refunds outpace
   *  inbound — surfaced as negative outstanding. */
  receivedPaise: number;
  /** Total of (order book + pipeline) value. */
  totalQuotedPaise: number;
  /** Outstanding = totalQuoted − received. Can be negative ("credit owed"). */
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
  /** PR13 2026-05-27: exec self-view. When set, OVERRIDES the captain
   *  team-scope visibility and pins to a single assigned_exec_user_id
   *  — the exec sees only their own requests. captainUserId +
   *  isSuperAdmin are ignored when this is set. */
  forceExecScope?: string;
}

export type FinanceListSort =
  | 'outstanding_desc'
  | 'date_desc'
  | 'date_asc'
  | 'value_desc';

export function parseFinanceListSort(raw: unknown): FinanceListSort {
  if (
    raw === 'date_desc' ||
    raw === 'date_asc' ||
    raw === 'value_desc' ||
    raw === 'outstanding_desc'
  ) {
    return raw;
  }
  return 'outstanding_desc';
}

interface ListFilters extends BaseFilters {
  page?: number;
  pageSize?: number;
  sort?: FinanceListSort;
}

// -----------------------------------------------------------------------------
// Shared predicate builder
// -----------------------------------------------------------------------------

async function resolveScope(
  captainUserId: string,
  isSuperAdmin: boolean,
  forceExecScope?: string,
) {
  // PR13 2026-05-27: exec self-view skips the captain city lookup —
  // the visibility is pinned by assigned_exec_user_id = me directly.
  if (forceExecScope) {
    return { allowed: true as const, cityIds: [] as string[] };
  }
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
  forceExecScope?: string,
) {
  // PR13 2026-05-27: exec self-view pins by assigned_exec instead of
  // routing through the captain team-scope helper.
  if (forceExecScope) {
    return eq(visitRequests.assignedExecUserId, forceExecScope);
  }
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
    // 2026-05-27 fix: anything BEFORE ORDER_CONFIRMED with a quotation
    // counts as pipeline. Previous version required exact
    // QUOTATION_GIVEN and silently dropped quotations saved at earlier
    // stages (the live Singham case — seq=3 VISIT_SCHEDULED).
    return lt(statusStages.sequenceNumber, ORDER_BOOK_MIN_SEQ);
  }
  // 'all' = every quoted request. The INNER JOIN with quotations
  // already guarantees a quote exists; no further stage gate needed.
  return undefined;
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
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin, args.forceExecScope);
  if (!scope.allowed) {
    return {
      orderBook: { totalPaise: 0, count: 0 },
      pipeline: { totalPaise: 0, count: 0 },
      receivedPaise: 0,
      totalQuotedPaise: 0,
      outstandingPaise: 0,
    };
  }

  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
    args.forceExecScope,
  );

  // 2026-05-27 fix: drop the stage-gate WHERE entirely. The INNER
  // JOIN with quotations already restricts to quoted requests; we
  // want EVERY quote regardless of stage so a fresh quote at
  // VISIT_SCHEDULED still counts toward Pipeline.
  const where = and(
    isNull(visitRequests.cancelledAt),
    scopeWhere,
    args.execFilter
      ? eq(visitRequests.assignedExecUserId, args.execFilter)
      : undefined,
    args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
    searchPredicate(args.search),
  );

  const [aggRow] = await db
    .select({
      orderBookTotal: sql<number>`COALESCE(SUM(CASE WHEN ${statusStages.sequenceNumber} >= ${ORDER_BOOK_MIN_SEQ} THEN ${quotations.totalOrderValuePaise} ELSE 0 END), 0)::bigint`,
      orderBookCount: sql<number>`COUNT(*) FILTER (WHERE ${statusStages.sequenceNumber} >= ${ORDER_BOOK_MIN_SEQ})::int`,
      pipelineTotal: sql<number>`COALESCE(SUM(CASE WHEN ${statusStages.sequenceNumber} < ${ORDER_BOOK_MIN_SEQ} THEN ${quotations.totalOrderValuePaise} ELSE 0 END), 0)::bigint`,
      pipelineCount: sql<number>`COUNT(*) FILTER (WHERE ${statusStages.sequenceNumber} < ${ORDER_BOOK_MIN_SEQ})::int`,
    })
    .from(visitRequests)
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(where);

  // 2026-05-27 fix: Received now counts inbound − outbound on EVERY
  // quoted request, not just Order Book. Pre-confirmation deposits
  // (Singham case: ₹5,000 on a ₹25,000 quote at VISIT_SCHEDULED) are
  // legitimate cash the captain has collected.
  const [payRow] = await db
    .select({
      received: sql<number>`COALESCE(SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE -${payments.amountPaise} END), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .where(
      and(
        isNull(payments.voidedAt),
        isNull(visitRequests.cancelledAt),
        scopeWhere,
        args.execFilter
          ? eq(visitRequests.assignedExecUserId, args.execFilter)
          : undefined,
        args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
      ),
    );

  const orderBookTotal = Number(aggRow?.orderBookTotal ?? 0);
  const pipelineTotal = Number(aggRow?.pipelineTotal ?? 0);
  const receivedPaise = Number(payRow?.received ?? 0);
  const totalQuotedPaise = orderBookTotal + pipelineTotal;

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
    totalQuotedPaise,
    // Outstanding now spans BOTH axes — a deposit on a pre-confirmation
    // quote reduces the captain's "money owed" total even though the
    // order isn't yet on the books in the strict sense.
    outstandingPaise: totalQuotedPaise - receivedPaise,
  };
}

// -----------------------------------------------------------------------------
// Aging buckets — every quoted request with positive outstanding
// -----------------------------------------------------------------------------

export async function loadFinanceAgingBuckets(
  args: BaseFilters,
): Promise<FinanceAgingBucket[]> {
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin, args.forceExecScope);
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
    args.forceExecScope,
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
    .where(
      and(
        isNull(visitRequests.cancelledAt),
        scopeWhere,
        args.execFilter
          ? eq(visitRequests.assignedExecUserId, args.execFilter)
          : undefined,
        args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
        searchPredicate(args.search),
        // 2026-05-27 fix: drop the ORDER_CONFIRMED gate. Aging applies
        // to every outstanding quote, not just confirmed orders — a
        // 30-day-old pre-confirmation quote with no deposit is just as
        // important to follow up on.
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

// Returns the ORDER BY clauses for a given sort key. Outsourced so the
// list query stays readable. Tie-breakers chosen for stability:
//   outstanding_desc → biggest money chase first, oldest quote next
//   date_desc        → newest quote first, biggest outstanding next
//   date_asc         → oldest quote first, biggest outstanding next
//   value_desc       → biggest order value first, oldest quote next
function sortOrderBy(sort: FinanceListSort) {
  const outstandingExpr = sql`${quotations.totalOrderValuePaise} - COALESCE((
    SELECT SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE -${payments.amountPaise} END)
    FROM ${payments}
    WHERE ${payments.visitRequestId} = ${visitRequests.id}
      AND ${payments.voidedAt} IS NULL
  ), 0)`;
  if (sort === 'date_desc') {
    return [desc(quotations.submittedAt), desc(outstandingExpr)];
  }
  if (sort === 'date_asc') {
    return [asc(quotations.submittedAt), desc(outstandingExpr)];
  }
  if (sort === 'value_desc') {
    return [desc(quotations.totalOrderValuePaise), asc(quotations.submittedAt)];
  }
  // outstanding_desc — default
  return [desc(outstandingExpr), asc(quotations.submittedAt)];
}

export async function loadFinanceOrderList(
  args: ListFilters,
): Promise<{ rows: FinanceOrderRow[]; total: number; pageRange: ReturnType<typeof computePageRange> }> {
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin, args.forceExecScope);
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
    args.forceExecScope,
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
    .orderBy(...sortOrderBy(args.sort ?? 'outstanding_desc'))
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
  const scope = await resolveScope(args.captainUserId, args.isSuperAdmin, args.forceExecScope);
  if (!scope.allowed) return [];

  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
    args.forceExecScope,
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

// =============================================================================
// Sandeep 2026-06-03: tile-drilldown — per-payment detail for the
// "Received" hero tile sheet
// =============================================================================
//
// The Received tile sums net inbound − outbound across the scoped
// requests. The drilldown table lists every individual payment row
// (chronological desc) so admins / captains / execs can see exactly
// which transactions add up to the headline figure. Refunds appear
// as outbound rows with their amount displayed negative.

export interface FinancePaymentRow {
  id: string;
  paymentDate: string; // YYYY-MM-DD
  amountPaise: number; // signed: positive = inbound, negative = outbound
  direction: 'inbound' | 'outbound';
  mode: string;
  customerName: string;
  requestId: string;
  execName: string | null;
  recordedByName: string | null;
}

export async function loadFinanceReceivedDetail(args: {
  captainUserId: string;
  isSuperAdmin: boolean;
  forceExecScope?: string;
  execFilter?: string;
  cityFilter?: string;
  /** Cap on returned rows. Default 100 — matches the tile-sheet UX
   *  ("first N most recent; for the full list, use the page below"). */
  limit?: number;
}): Promise<FinancePaymentRow[]> {
  const scope = await resolveScope(
    args.captainUserId,
    args.isSuperAdmin,
    args.forceExecScope,
  );
  if (!scope.allowed) return [];

  const scopeWhere = buildScopePredicate(
    args.captainUserId,
    args.isSuperAdmin,
    scope.cityIds,
    args.forceExecScope,
  );

  const execUser = alias(users, 'finance_payment_exec');
  const recordedUser = alias(users, 'finance_payment_recorder');

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
      recordedByName: recordedUser.fullName,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .leftJoin(recordedUser, eq(recordedUser.id, payments.recordedByUserId))
    .where(
      and(
        isNull(visitRequests.cancelledAt),
        isNull(payments.voidedAt),
        scopeWhere,
        args.execFilter
          ? eq(visitRequests.assignedExecUserId, args.execFilter)
          : undefined,
        args.cityFilter ? eq(visitRequests.cityId, args.cityFilter) : undefined,
      ),
    )
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
    .limit(args.limit ?? 100);

  return rows.map<FinancePaymentRow>((r) => ({
    id: r.id,
    paymentDate: r.paymentDate,
    // Negative sign on outbound so the table's "Amount" column can
    // render the signed value directly without per-row branching.
    amountPaise:
      r.direction === 'outbound' ? -Number(r.amountPaise) : Number(r.amountPaise),
    direction: r.direction,
    mode: r.mode,
    customerName: r.customerName,
    requestId: r.requestId,
    execName: r.execName,
    recordedByName: r.recordedByName,
  }));
}
