import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  payments,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';

import { vrScope } from './scope';
import type { ReportRange, ReportScope } from './types';

// =============================================================================
// Reports — Graphs data layer
// =============================================================================
//
// Curated 6-chart dataset for the /admin /captain /exec /reports/graphs
// surface. Mirrors the same SSOT discipline as lib/reports/sales.ts:
//
//   * net cash (inbound − outbound) for revenue series
//   * IST timezone wrap on every timestamptz date cast
//   * DISTINCT request_id on status_history joins (rollback safe)
//   * attribution via visit_requests.assigned_exec_user_id, not the
//     action-taker captain
//
// Every loader accepts (scope, range). The page renders the result in
// a recharts SVG. The range comes from the page (default 30 days IST).
//
// IMPORTANT: clients only see paise integers. Conversion to rupees
// happens at the display boundary in the chart component's tooltip.
// =============================================================================

export interface GraphsArgs {
  scope: ReportScope;
  range: ReportRange;
}

// -----------------------------------------------------------------------------
// Shared row shapes
// -----------------------------------------------------------------------------

export interface DayBucketRow {
  /** YYYY-MM-DD (IST). */
  day: string;
  /** Primary metric. */
  value: number;
}

export interface TwoSeriesDayRow {
  day: string;
  a: number;
  b: number;
}

export interface FunnelStageRow {
  stageCode: string;
  stageName: string;
  sequence: number;
  requestsReached: number;
}

export interface CityShareRow {
  cityId: string;
  cityName: string;
  /** Net cash revenue in paise for this city across the window. */
  revenuePaise: number;
}

export interface ExecLeaderRow {
  execUserId: string;
  execName: string;
  ordersConfirmed: number;
  revenuePaise: number;
}

export interface ConversionDayRow {
  day: string;
  /** 0..100 — percent of QUOTATION_GIVEN reaching ORDER_CONFIRMED in the
   *  same window (request-anchored, not bucketed by quotation date). */
  conversionPct: number;
  ordersCount: number;
  quotationsCount: number;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function dayCastTz(col: ReturnType<typeof sql>) {
  return sql`(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
}

/**
 * Build a `[fromDate, toDate]` zero-filled bucket list so the chart
 * shows a continuous x-axis even on days with no data. Date arithmetic
 * is in UTC since the input is already an IST-anchored YYYY-MM-DD
 * string.
 */
export function buildDayBuckets(
  range: ReportRange,
): string[] {
  const [fy, fm, fd] = range.fromDate.split('-').map(Number);
  const [ty, tm, td] = range.toDate.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const dt = new Date(t);
    days.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return days;
}

function zeroFillDays<T extends { day: string }>(
  rows: T[],
  range: ReportRange,
  pad: (day: string) => T,
): T[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  return buildDayBuckets(range).map((day) => map.get(day) ?? pad(day));
}

// -----------------------------------------------------------------------------
// 1. Revenue trend (net inbound − outbound, paise per IST day)
// -----------------------------------------------------------------------------

export async function graphRevenueTrend(
  args: GraphsArgs,
): Promise<DayBucketRow[]> {
  const scopeWhere = vrScope(args.scope);
  const rows = await db
    .select({
      day: sql<string>`${payments.paymentDate}::text`,
      value: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, args.range.fromDate),
        lte(payments.paymentDate, args.range.toDate),
        scopeWhere,
      ),
    )
    .groupBy(payments.paymentDate);

  const shaped = rows.map<DayBucketRow>((r) => ({
    day: r.day,
    value: Number(r.value),
  }));
  return zeroFillDays(shaped, args.range, (day) => ({ day, value: 0 }));
}

// -----------------------------------------------------------------------------
// 2. Visits and Orders by day (two series)
// -----------------------------------------------------------------------------
//
// Both series come from request_status_history with DISTINCT request_id
// per bucket so a rollback + re-advance within the window counts once.
// -----------------------------------------------------------------------------

export async function graphVisitsOrdersByDay(
  args: GraphsArgs,
): Promise<TwoSeriesDayRow[]> {
  const scopeWhere = vrScope(args.scope);
  const dayCol = dayCastTz(sql`${requestStatusHistory.changedAt}`);

  const rows = await db
    .select({
      day: sql<string>`${dayCol}::text`,
      stageCode: statusStages.code,
      cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(
      statusStages,
      eq(statusStages.id, requestStatusHistory.toStatusStageId),
    )
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, requestStatusHistory.requestId),
    )
    .where(
      and(
        inArray(statusStages.code, ['VISIT_COMPLETED', 'ORDER_CONFIRMED']),
        gte(dayCol, args.range.fromDate),
        lte(dayCol, args.range.toDate),
        scopeWhere,
      ),
    )
    .groupBy(dayCol, statusStages.code);

  // Pivot.
  const acc = new Map<string, TwoSeriesDayRow>();
  for (const r of rows) {
    const day = String(r.day);
    const existing = acc.get(day) ?? { day, a: 0, b: 0 };
    if (r.stageCode === 'VISIT_COMPLETED') existing.a = r.cnt ?? 0;
    if (r.stageCode === 'ORDER_CONFIRMED') existing.b = r.cnt ?? 0;
    acc.set(day, existing);
  }
  const shaped = Array.from(acc.values());
  return zeroFillDays(shaped, args.range, (day) => ({ day, a: 0, b: 0 }));
}

// -----------------------------------------------------------------------------
// 3. Status funnel — distinct requests that reached each stage in window
// -----------------------------------------------------------------------------

export async function graphStatusFunnel(
  args: GraphsArgs,
): Promise<FunnelStageRow[]> {
  const scopeWhere = vrScope(args.scope);

  const stages = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequence: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(asc(statusStages.sequenceNumber));

  const dayCol = dayCastTz(sql`${requestStatusHistory.changedAt}`);
  const counts = await db
    .select({
      stageId: requestStatusHistory.toStatusStageId,
      cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, requestStatusHistory.requestId),
    )
    .where(
      and(
        gte(dayCol, args.range.fromDate),
        lte(dayCol, args.range.toDate),
        scopeWhere,
      ),
    )
    .groupBy(requestStatusHistory.toStatusStageId);

  const byStage = new Map(counts.map((c) => [c.stageId, c.cnt ?? 0]));
  return stages.map<FunnelStageRow>((s) => ({
    stageCode: s.code,
    stageName: s.name,
    sequence: s.sequence,
    requestsReached: byStage.get(s.id) ?? 0,
  }));
}

// -----------------------------------------------------------------------------
// 4. City revenue share (donut)
// -----------------------------------------------------------------------------

export async function graphCityShare(
  args: GraphsArgs,
): Promise<CityShareRow[]> {
  const scopeWhere = vrScope(args.scope);

  const rows = await db
    .select({
      cityId: cities.id,
      cityName: cities.name,
      revenuePaise: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, args.range.fromDate),
        lte(payments.paymentDate, args.range.toDate),
        scopeWhere,
      ),
    )
    .groupBy(cities.id, cities.name);

  return rows
    .map<CityShareRow>((r) => ({
      cityId: r.cityId,
      cityName: r.cityName,
      revenuePaise: Number(r.revenuePaise),
    }))
    .filter((r) => r.revenuePaise > 0)
    .sort((a, b) => b.revenuePaise - a.revenuePaise);
}

// -----------------------------------------------------------------------------
// 5. Top execs by orders confirmed
// -----------------------------------------------------------------------------
//
// Attribution: COUNT(DISTINCT request_id) where the assigned exec
// reached ORDER_CONFIRMED in the window. Revenue alongside for
// secondary sort context — same net-cash math.
//
// Limited to the top 5 by orders for readability. Exec scope returns
// just the caller's row so the chart degrades gracefully.
// -----------------------------------------------------------------------------

export async function graphTopExecsByOrders(
  args: GraphsArgs,
): Promise<ExecLeaderRow[]> {
  const scopeWhere = vrScope(args.scope);
  const dayCol = dayCastTz(sql`${requestStatusHistory.changedAt}`);

  // 5a — orders per exec
  const orders = await db
    .select({
      execUserId: visitRequests.assignedExecUserId,
      ordersCount: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(
      statusStages,
      eq(statusStages.id, requestStatusHistory.toStatusStageId),
    )
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, requestStatusHistory.requestId),
    )
    .where(
      and(
        eq(statusStages.code, 'ORDER_CONFIRMED'),
        gte(dayCol, args.range.fromDate),
        lte(dayCol, args.range.toDate),
        scopeWhere,
      ),
    )
    .groupBy(visitRequests.assignedExecUserId);

  const execIds = orders
    .map((r) => r.execUserId)
    .filter((x): x is string => Boolean(x));
  if (execIds.length === 0) return [];

  // 5b — revenue per exec for the same window
  const revenue = await db
    .select({
      execUserId: visitRequests.assignedExecUserId,
      revenuePaise: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, args.range.fromDate),
        lte(payments.paymentDate, args.range.toDate),
        inArray(visitRequests.assignedExecUserId, execIds),
      ),
    )
    .groupBy(visitRequests.assignedExecUserId);
  const revenueByExec = new Map(
    revenue.map((r) => [r.execUserId, Number(r.revenuePaise)]),
  );

  // 5c — display names
  const names = await db
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(inArray(users.id, execIds));
  const nameById = new Map(names.map((n) => [n.id, n.name ?? '—']));

  const merged = orders
    .map<ExecLeaderRow>((o) => ({
      execUserId: o.execUserId as string,
      execName: nameById.get(o.execUserId as string) ?? '—',
      ordersConfirmed: o.ordersCount ?? 0,
      revenuePaise: revenueByExec.get(o.execUserId as string) ?? 0,
    }))
    .sort((a, b) => b.ordersConfirmed - a.ordersConfirmed);

  // Cap at 5 for everyone except exec scope (which already returns a
  // single row).
  return args.scope.kind === 'exec' ? merged : merged.slice(0, 5);
}

// -----------------------------------------------------------------------------
// 6. Conversion rate trend (line)
// -----------------------------------------------------------------------------
//
// Per IST day: (orders confirmed) / (quotations submitted) × 100.
// Both numerator and denominator use DISTINCT request_id so rollback
// chatter doesn't skew. Day with zero quotations → null (charted as a
// gap, not a 0).
// -----------------------------------------------------------------------------

export async function graphConversionTrend(
  args: GraphsArgs,
): Promise<ConversionDayRow[]> {
  const scopeWhere = vrScope(args.scope);
  const dayCol = dayCastTz(sql`${requestStatusHistory.changedAt}`);

  const rows = await db
    .select({
      day: sql<string>`${dayCol}::text`,
      stageCode: statusStages.code,
      cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(
      statusStages,
      eq(statusStages.id, requestStatusHistory.toStatusStageId),
    )
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, requestStatusHistory.requestId),
    )
    .where(
      and(
        inArray(statusStages.code, ['QUOTATION_GIVEN', 'ORDER_CONFIRMED']),
        gte(dayCol, args.range.fromDate),
        lte(dayCol, args.range.toDate),
        scopeWhere,
      ),
    )
    .groupBy(dayCol, statusStages.code);

  const byDay = new Map<string, { q: number; o: number }>();
  for (const r of rows) {
    const day = String(r.day);
    const slot = byDay.get(day) ?? { q: 0, o: 0 };
    if (r.stageCode === 'QUOTATION_GIVEN') slot.q = r.cnt ?? 0;
    if (r.stageCode === 'ORDER_CONFIRMED') slot.o = r.cnt ?? 0;
    byDay.set(day, slot);
  }

  const shaped: ConversionDayRow[] = Array.from(byDay.entries()).map(
    ([day, { q, o }]) => ({
      day,
      quotationsCount: q,
      ordersCount: o,
      conversionPct: q > 0 ? Math.round((o / q) * 1000) / 10 : 0,
    }),
  );
  return zeroFillDays(shaped, args.range, (day) => ({
    day,
    quotationsCount: 0,
    ordersCount: 0,
    conversionPct: 0,
  }));
}

// -----------------------------------------------------------------------------
// Bundle loader — runs the 6 queries in parallel
// -----------------------------------------------------------------------------

export interface GraphsBundle {
  revenue: DayBucketRow[];
  visitsOrders: TwoSeriesDayRow[];
  funnel: FunnelStageRow[];
  cityShare: CityShareRow[];
  topExecs: ExecLeaderRow[];
  conversion: ConversionDayRow[];
}

export async function loadGraphsBundle(args: GraphsArgs): Promise<GraphsBundle> {
  const [revenue, visitsOrders, funnel, cityShare, topExecs, conversion] =
    await Promise.all([
      graphRevenueTrend(args),
      graphVisitsOrdersByDay(args),
      graphStatusFunnel(args),
      graphCityShare(args),
      graphTopExecsByOrders(args),
      graphConversionTrend(args),
    ]);
  return { revenue, visitsOrders, funnel, cityShare, topExecs, conversion };
}
