import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  dayPlans,
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  tasks,
  visitRequests,
} from '@/db/schema';

import { formatPaise } from './sales';
import type { ReportArgs, ReportResult } from './types';
import { REPORT_PAGE_SIZE } from './types';

// =============================================================================
// Geography + Operational reports (Sprint 3, reports 19-30)
// =============================================================================
//
// All city-level reports use visit_requests.city_id as the canonical
// city. Operational reports look at day_plans + status_history.
// =============================================================================

const VISIT_TASK_TYPES = ['Customer home visit', 'Sales pitch', 'Outlet visit'] as const;

interface CityAggRow {
  cityId: string;
  cityName: string;
  execCount: number;
  revenuePaise: number;
  ordersCount: number;
  orderValuePaise: number;
  visits: number;
  conversionPct: number | null;
  revenuePerExecPaise: number;
}

function paginate<T>(rows: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

function sortCity(
  rows: CityAggRow[],
  key: string | undefined,
  dir: 'asc' | 'desc' | undefined,
): CityAggRow[] {
  const sortKey = (key ?? 'revenuePaise') as keyof CityAggRow;
  const direction = dir ?? 'desc';
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp = 0;
    if (av === null && bv === null) cmp = 0;
    else if (av === null) cmp = -1;
    else if (bv === null) cmp = 1;
    else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return direction === 'asc' ? cmp : -cmp;
  });
}

async function loadCityAggregates(args: ReportArgs): Promise<CityAggRow[]> {
  const { fromDate, toDate } = args.range;
  const cityRows = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.isActive, true))
    .orderBy(asc(cities.name));
  if (cityRows.length === 0) return [];
  const cityIds = cityRows.map((c) => c.id);

  // exec counts per city
  const execCounts = await db
    .select({
      cityId: salesExecutives.cityId,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(salesExecutives)
    .where(inArray(salesExecutives.cityId, cityIds))
    .groupBy(salesExecutives.cityId);
  const execCountMap = new Map<string, number>();
  for (const r of execCounts) if (r.cityId) execCountMap.set(r.cityId, r.cnt);

  const [paymentAgg, visitsAgg, ordersAgg] = await Promise.all([
    db
      .select({
        cityId: visitRequests.cityId,
        netPaise: sql<number>`COALESCE(SUM(
          CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
               WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
               ELSE 0 END
        ), 0)::bigint`,
      })
      .from(payments)
      .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
      .where(
        and(
          inArray(visitRequests.cityId, cityIds),
          isNull(payments.voidedAt),
          gte(payments.paymentDate, fromDate),
          lte(payments.paymentDate, toDate),
        ),
      )
      .groupBy(visitRequests.cityId),
    db
      .select({
        cityId: salesExecutives.cityId,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(tasks)
      .innerJoin(salesExecutives, eq(salesExecutives.userId, tasks.execUserId))
      .where(
        and(
          inArray(salesExecutives.cityId, cityIds),
          sql`${tasks.taskType} IN (${sql.join(
            VISIT_TASK_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )})`,
          eq(tasks.status, 'completed'),
          gte(tasks.taskDate, fromDate),
          lte(tasks.taskDate, toDate),
        ),
      )
      .groupBy(salesExecutives.cityId),
    db
      .select({
        cityId: visitRequests.cityId,
        cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
        valuePaise: sql<number>`COALESCE(SUM(${quotations.totalOrderValuePaise}), 0)::bigint`,
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
      .leftJoin(
        quotations,
        eq(quotations.visitRequestId, requestStatusHistory.requestId),
      )
      .where(
        and(
          eq(statusStages.code, 'ORDER_CONFIRMED'),
          inArray(visitRequests.cityId, cityIds),
          gte(
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            fromDate,
          ),
          lte(
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            toDate,
          ),
        ),
      )
      .groupBy(visitRequests.cityId),
  ]);

  const revByCity = new Map<string, number>();
  for (const r of paymentAgg) if (r.cityId) revByCity.set(r.cityId, Number(r.netPaise));
  const visitsByCity = new Map<string, number>();
  for (const r of visitsAgg) if (r.cityId) visitsByCity.set(r.cityId, r.cnt);
  const ordersByCity = new Map<string, { cnt: number; value: number }>();
  for (const r of ordersAgg)
    if (r.cityId)
      ordersByCity.set(r.cityId, { cnt: r.cnt, value: Number(r.valuePaise) });

  return cityRows.map<CityAggRow>((c) => {
    const orders = ordersByCity.get(c.id) ?? { cnt: 0, value: 0 };
    const visits = visitsByCity.get(c.id) ?? 0;
    const execCount = execCountMap.get(c.id) ?? 0;
    const revenue = revByCity.get(c.id) ?? 0;
    return {
      cityId: c.id,
      cityName: c.name,
      execCount,
      revenuePaise: revenue,
      ordersCount: orders.cnt,
      orderValuePaise: orders.value,
      visits,
      conversionPct: visits > 0 ? Math.round((orders.cnt / visits) * 100) : null,
      revenuePerExecPaise: execCount > 0 ? Math.round(revenue / execCount) : 0,
    };
  });
}

// -----------------------------------------------------------------------------
// 19. Per-city revenue
// 20. Per-city orders
// 21. Per-city conversion %
// 22. City heatmap — revenue per active exec
// -----------------------------------------------------------------------------

const CITY_COLUMNS_COMMON = [
  { key: 'cityName', label: 'City', format: 'string' as const, align: 'left' as const, sortable: true },
  { key: 'execCount', label: 'Execs', format: 'number' as const, align: 'right' as const, sortable: true },
];

function cityFooter(rows: CityAggRow[]): ReportResult<CityAggRow>['footer'] {
  return {
    entries: [
      { label: 'Cities', value: String(rows.length) },
      { label: 'Total revenue', value: formatPaise(rows.reduce((s, r) => s + r.revenuePaise, 0)) },
      { label: 'Total orders', value: String(rows.reduce((s, r) => s + r.ordersCount, 0)) },
      { label: 'Total visits', value: String(rows.reduce((s, r) => s + r.visits, 0)) },
    ],
  };
}

function paginateCity(args: ReportArgs, rows: CityAggRow[]): CityAggRow[] {
  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return paginate(rows, page, pageSize);
}

export async function reportCityRevenue(
  args: ReportArgs,
): Promise<ReportResult<CityAggRow>> {
  let rows = await loadCityAggregates(args);
  rows = sortCity(rows, args.sort?.key ?? 'revenuePaise', args.sort?.direction ?? 'desc');
  return {
    rows: paginateCity(args, rows),
    total: rows.length,
    columns: [
      ...CITY_COLUMNS_COMMON,
      { key: 'revenuePaise', label: 'Revenue (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: cityFooter(rows),
  };
}

export async function reportCityOrders(
  args: ReportArgs,
): Promise<ReportResult<CityAggRow>> {
  let rows = await loadCityAggregates(args);
  rows = sortCity(rows, args.sort?.key ?? 'ordersCount', args.sort?.direction ?? 'desc');
  return {
    rows: paginateCity(args, rows),
    total: rows.length,
    columns: [
      ...CITY_COLUMNS_COMMON,
      { key: 'ordersCount', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'orderValuePaise', label: 'Order value (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: cityFooter(rows),
  };
}

export async function reportCityConversion(
  args: ReportArgs,
): Promise<ReportResult<CityAggRow>> {
  let rows = await loadCityAggregates(args);
  rows = sortCity(rows, args.sort?.key ?? 'conversionPct', args.sort?.direction ?? 'desc');
  return {
    rows: paginateCity(args, rows),
    total: rows.length,
    columns: [
      ...CITY_COLUMNS_COMMON,
      { key: 'visits', label: 'Visits', format: 'number', align: 'right', sortable: true },
      { key: 'ordersCount', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'conversionPct', label: 'Conversion %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: cityFooter(rows),
  };
}

export async function reportCityHeatmap(
  args: ReportArgs,
): Promise<ReportResult<CityAggRow>> {
  let rows = await loadCityAggregates(args);
  rows = sortCity(rows, args.sort?.key ?? 'revenuePerExecPaise', args.sort?.direction ?? 'desc');
  return {
    rows: paginateCity(args, rows),
    total: rows.length,
    columns: [
      ...CITY_COLUMNS_COMMON,
      { key: 'revenuePaise', label: 'Revenue (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'revenuePerExecPaise', label: 'Revenue per exec (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: cityFooter(rows),
  };
}

// =============================================================================
// Operational reports (23-30)
// =============================================================================

// -----------------------------------------------------------------------------
// 23. Day-plan submission rate per period
// 24. Day-plan close rate per period
// 25. Rolled-over task rate per period
// -----------------------------------------------------------------------------

interface DayPlanRow {
  bucket: string;
  planDays: number;
  closedDays: number;
  notClosed: number;
  closeRatePct: number | null;
}

export async function reportDayPlanClose(
  args: ReportArgs,
): Promise<ReportResult<DayPlanRow>> {
  const { fromDate, toDate } = args.range;

  const rows = await db
    .select({
      bucket: sql<string>`${dayPlans.planDate}::text`,
      planDays: sql<number>`COUNT(*)::int`,
      closedDays: sql<number>`SUM(CASE WHEN ${dayPlans.closedAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
    })
    .from(dayPlans)
    .where(
      and(
        gte(dayPlans.planDate, fromDate),
        lte(dayPlans.planDate, toDate),
        isNotNull(dayPlans.submittedAt),
      ),
    )
    .groupBy(dayPlans.planDate);

  const all = rows.map<DayPlanRow>((r) => ({
    bucket: r.bucket,
    planDays: r.planDays,
    closedDays: r.closedDays,
    notClosed: r.planDays - r.closedDays,
    closeRatePct:
      r.planDays > 0 ? Math.round((r.closedDays / r.planDays) * 100) : null,
  }));

  const sortKey = args.sort?.key ?? 'bucket';
  const dir = args.sort?.direction ?? 'desc';
  all.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'planDays') cmp = a.planDays - b.planDays;
    else if (sortKey === 'closedDays') cmp = a.closedDays - b.closedDays;
    else if (sortKey === 'closeRatePct')
      cmp = (a.closeRatePct ?? -1) - (b.closeRatePct ?? -1);
    else cmp = a.bucket.localeCompare(b.bucket);
    return dir === 'asc' ? cmp : -cmp;
  });

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const totalPlans = all.reduce((s, r) => s + r.planDays, 0);
  const totalClosed = all.reduce((s, r) => s + r.closedDays, 0);
  const overallRate = totalPlans > 0 ? Math.round((totalClosed / totalPlans) * 100) : null;

  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'planDays', label: 'Plans submitted', format: 'number', align: 'right', sortable: true },
      { key: 'closedDays', label: 'Plans closed', format: 'number', align: 'right', sortable: true },
      { key: 'notClosed', label: 'Not closed', format: 'number', align: 'right', sortable: true },
      { key: 'closeRatePct', label: 'Close rate %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Days observed', value: String(all.length) },
        { label: 'Plans submitted', value: String(totalPlans) },
        { label: 'Plans closed', value: String(totalClosed) },
        { label: 'Overall close rate', value: overallRate === null ? '—' : `${overallRate}%` },
      ],
    },
  };
}

interface RolloverRow {
  bucket: string;
  totalTasks: number;
  rolledOver: number;
  rolloverPct: number | null;
}

export async function reportTaskRollover(
  args: ReportArgs,
): Promise<ReportResult<RolloverRow>> {
  const { fromDate, toDate } = args.range;

  const rows = await db
    .select({
      bucket: sql<string>`${tasks.taskDate}::text`,
      totalTasks: sql<number>`COUNT(*)::int`,
      rolledOver: sql<number>`SUM(CASE WHEN ${tasks.rolledOverAt} IS NOT NULL THEN 1 ELSE 0 END)::int`,
    })
    .from(tasks)
    .where(
      and(gte(tasks.taskDate, fromDate), lte(tasks.taskDate, toDate)),
    )
    .groupBy(tasks.taskDate);

  const all = rows.map<RolloverRow>((r) => ({
    bucket: r.bucket,
    totalTasks: r.totalTasks,
    rolledOver: r.rolledOver,
    rolloverPct:
      r.totalTasks > 0 ? Math.round((r.rolledOver / r.totalTasks) * 100) : null,
  }));
  const sortKey = args.sort?.key ?? 'bucket';
  const dir = args.sort?.direction ?? 'desc';
  all.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'totalTasks') cmp = a.totalTasks - b.totalTasks;
    else if (sortKey === 'rolledOver') cmp = a.rolledOver - b.rolledOver;
    else if (sortKey === 'rolloverPct')
      cmp = (a.rolloverPct ?? -1) - (b.rolloverPct ?? -1);
    else cmp = a.bucket.localeCompare(b.bucket);
    return dir === 'asc' ? cmp : -cmp;
  });

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'totalTasks', label: 'Total tasks', format: 'number', align: 'right', sortable: true },
      { key: 'rolledOver', label: 'Rolled over', format: 'number', align: 'right', sortable: true },
      { key: 'rolloverPct', label: 'Rollover %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Days observed', value: String(all.length) },
        { label: 'Total rolled', value: String(all.reduce((s, r) => s + r.rolledOver, 0)) },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 26. Pending approvals queue depth per day
// -----------------------------------------------------------------------------

interface QueueRow {
  bucket: string;
  depth: number;
}

export async function reportApprovalsQueueDepth(
  args: ReportArgs,
): Promise<ReportResult<QueueRow>> {
  // Approximation: snapshot today's depth. Historical depth requires
  // status-history reconstruction; this MVP returns just current.
  const [{ id: pendingStageId }] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
    .limit(1);

  const [{ depth }] = await db
    .select({
      depth: sql<number>`COUNT(*)::int`,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.statusStageId, pendingStageId),
        isNull(visitRequests.cancelledAt),
      ),
    );

  return {
    rows: [{ bucket: args.range.toDate, depth }],
    total: 1,
    columns: [
      { key: 'bucket', label: 'As of', format: 'date', align: 'left', sortable: false },
      { key: 'depth', label: 'Pending approvals', format: 'number', align: 'right', sortable: false },
    ],
    footer: {
      entries: [{ label: 'Current depth', value: String(depth) }],
    },
  };
}

// -----------------------------------------------------------------------------
// 27. Captain approval SLA (PENDING → ORDER_EXECUTED_SUCCESSFULLY hours)
// -----------------------------------------------------------------------------

interface SLARow {
  requestId: string;
  customerName: string;
  pendingAt: string;
  approvedAt: string;
  hoursPending: number;
}

export async function reportApprovalSla(
  args: ReportArgs,
): Promise<ReportResult<SLARow>> {
  const { fromDate, toDate } = args.range;
  const result = await db.execute<{
    request_id: string;
    customer_name: string;
    pending_at: string;
    approved_at: string;
    hours_pending: number;
  }>(sql`
    WITH pending_entry AS (
      SELECT rsh.request_id, MIN(rsh.changed_at) AS pending_at
      FROM ${requestStatusHistory} rsh
      INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
      WHERE ss.code = 'PENDING_CAPTAIN_APPROVAL'
      GROUP BY rsh.request_id
    ),
    approved AS (
      SELECT rsh.request_id, MIN(rsh.changed_at) AS approved_at
      FROM ${requestStatusHistory} rsh
      INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
      WHERE ss.code = 'ORDER_EXECUTED_SUCCESSFULLY'
        AND (rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date >= ${fromDate}
        AND (rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date <= ${toDate}
      GROUP BY rsh.request_id
    )
    SELECT
      pe.request_id,
      vr.customer_name,
      pe.pending_at::text AS pending_at,
      ap.approved_at::text AS approved_at,
      EXTRACT(EPOCH FROM (ap.approved_at - pe.pending_at)) / 3600 AS hours_pending
    FROM approved ap
    INNER JOIN pending_entry pe ON pe.request_id = ap.request_id
    INNER JOIN ${visitRequests} vr ON vr.id = ap.request_id
    ORDER BY hours_pending DESC
  `);
  const raw = (result as unknown as { rows?: SLARow[] }).rows
    ?? (result as unknown as SLARow[]);
  const all = ((raw as unknown as Array<{
    request_id: string;
    customer_name: string;
    pending_at: string;
    approved_at: string;
    hours_pending: number;
  }>) ?? []).map<SLARow>((r) => ({
    requestId: r.request_id,
    customerName: r.customer_name,
    pendingAt: r.pending_at,
    approvedAt: r.approved_at,
    hoursPending: Math.round(Number(r.hours_pending)),
  }));

  const sortKey = args.sort?.key ?? 'hoursPending';
  const dir = args.sort?.direction ?? 'desc';
  all.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'customerName') cmp = a.customerName.localeCompare(b.customerName);
    else if (sortKey === 'pendingAt') cmp = a.pendingAt.localeCompare(b.pendingAt);
    else if (sortKey === 'approvedAt') cmp = a.approvedAt.localeCompare(b.approvedAt);
    else cmp = a.hoursPending - b.hoursPending;
    return dir === 'asc' ? cmp : -cmp;
  });

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const avg =
    all.length > 0 ? Math.round(all.reduce((s, r) => s + r.hoursPending, 0) / all.length) : 0;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'requestId', label: 'Request', format: 'string', align: 'left', linksToRequest: true },
      { key: 'customerName', label: 'Customer', format: 'string', align: 'left', sortable: true },
      { key: 'pendingAt', label: 'Pending at', format: 'datetime', align: 'left', sortable: true },
      { key: 'approvedAt', label: 'Approved at', format: 'datetime', align: 'left', sortable: true },
      { key: 'hoursPending', label: 'Hours in queue', format: 'number', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Approvals in window', value: String(all.length) },
        { label: 'Average hours', value: String(avg) },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 28. Cancellation rate trend
// -----------------------------------------------------------------------------

interface CancellationRow {
  bucket: string;
  cancelled: number;
  total: number;
  cancellationPct: number | null;
}

export async function reportCancellationTrend(
  args: ReportArgs,
): Promise<ReportResult<CancellationRow>> {
  const { fromDate, toDate } = args.range;
  // Cancelled today vs all requests created today.
  const [cancelledRows, createdRows] = await Promise.all([
    db
      .select({
        bucket: sql<string>`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date::text`,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(visitRequests)
      .where(
        and(
          isNotNull(visitRequests.cancelledAt),
          gte(
            sql`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            fromDate,
          ),
          lte(
            sql`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            toDate,
          ),
        ),
      )
      .groupBy(
        sql`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date`,
      ),
    db
      .select({
        bucket: sql<string>`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date::text`,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(visitRequests)
      .where(
        and(
          gte(
            sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            fromDate,
          ),
          lte(
            sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            toDate,
          ),
        ),
      )
      .groupBy(
        sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
      ),
  ]);

  const map = new Map<string, CancellationRow>();
  for (const r of createdRows) {
    map.set(r.bucket, {
      bucket: r.bucket,
      cancelled: 0,
      total: r.cnt,
      cancellationPct: null,
    });
  }
  for (const r of cancelledRows) {
    const e = map.get(r.bucket);
    if (e) e.cancelled = r.cnt;
    else
      map.set(r.bucket, {
        bucket: r.bucket,
        cancelled: r.cnt,
        total: 0,
        cancellationPct: null,
      });
  }
  for (const v of map.values()) {
    v.cancellationPct =
      v.total > 0 ? Math.round((v.cancelled / v.total) * 100) : null;
  }
  let all = Array.from(map.values());
  all.sort((a, b) =>
    args.sort?.direction === 'asc'
      ? a.bucket.localeCompare(b.bucket)
      : b.bucket.localeCompare(a.bucket),
  );

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const totalCancelled = all.reduce((s, r) => s + r.cancelled, 0);
  const totalCreated = all.reduce((s, r) => s + r.total, 0);
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'total', label: 'Created', format: 'number', align: 'right', sortable: true },
      { key: 'cancelled', label: 'Cancelled', format: 'number', align: 'right', sortable: true },
      { key: 'cancellationPct', label: 'Cancellation %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total cancelled', value: String(totalCancelled) },
        { label: 'Total created', value: String(totalCreated) },
        {
          label: 'Overall rate',
          value:
            totalCreated > 0
              ? `${Math.round((totalCancelled / totalCreated) * 100)}%`
              : '—',
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 29. Refund frequency + value trend
// -----------------------------------------------------------------------------

interface RefundRow {
  bucket: string;
  refundCount: number;
  refundValuePaise: number;
}

export async function reportRefundTrend(
  args: ReportArgs,
): Promise<ReportResult<RefundRow>> {
  const { fromDate, toDate } = args.range;
  const rows = await db
    .select({
      bucket: sql<string>`${payments.paymentDate}::text`,
      refundCount: sql<number>`COUNT(*)::int`,
      refundValuePaise: sql<number>`COALESCE(SUM(${payments.amountPaise}), 0)::bigint`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.direction, 'outbound'),
        isNull(payments.voidedAt),
        gte(payments.paymentDate, fromDate),
        lte(payments.paymentDate, toDate),
      ),
    )
    .groupBy(payments.paymentDate);

  const all = rows.map<RefundRow>((r) => ({
    bucket: r.bucket,
    refundCount: r.refundCount,
    refundValuePaise: Number(r.refundValuePaise),
  }));
  all.sort((a, b) =>
    args.sort?.direction === 'asc'
      ? a.bucket.localeCompare(b.bucket)
      : b.bucket.localeCompare(a.bucket),
  );
  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'refundCount', label: 'Refunds', format: 'number', align: 'right', sortable: true },
      { key: 'refundValuePaise', label: 'Refund value (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total refunds', value: String(all.reduce((s, r) => s + r.refundCount, 0)) },
        {
          label: 'Total refund value',
          value: formatPaise(all.reduce((s, r) => s + r.refundValuePaise, 0)),
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 30. Outstanding aging snapshot
// -----------------------------------------------------------------------------

interface AgingRow {
  bucket: '0-7' | '8-30' | '30+';
  count: number;
  totalDuePaise: number;
}

export async function reportOutstandingAging(
  args: ReportArgs,
): Promise<ReportResult<AgingRow>> {
  void args;
  const result = await db.execute<{
    bucket: string;
    cnt: number;
    due_paise: number;
  }>(sql`
    WITH per_request AS (
      SELECT
        vr.id,
        MIN(q.submitted_at) AS quoted_at,
        MAX(q.total_order_value_paise) AS quoted,
        COALESCE(SUM(
          CASE WHEN p.voided_at IS NULL AND p.direction = 'inbound' THEN p.amount_paise
               WHEN p.voided_at IS NULL AND p.direction = 'outbound' THEN -p.amount_paise
               ELSE 0 END
        ), 0) AS net_paid
      FROM ${visitRequests} vr
      INNER JOIN ${quotations} q ON q.visit_request_id = vr.id
      LEFT JOIN ${payments} p ON p.visit_request_id = vr.id
      WHERE vr.cancelled_at IS NULL
      GROUP BY vr.id
    )
    SELECT
      CASE
        WHEN EXTRACT(DAY FROM NOW() - quoted_at) <= 7 THEN '0-7'
        WHEN EXTRACT(DAY FROM NOW() - quoted_at) <= 30 THEN '8-30'
        ELSE '30+'
      END AS bucket,
      COUNT(*)::int AS cnt,
      COALESCE(SUM(GREATEST(quoted - net_paid, 0)), 0)::bigint AS due_paise
    FROM per_request
    WHERE quoted - net_paid > 0
    GROUP BY bucket
  `);
  const raw = (result as unknown as { rows?: Array<{ bucket: string; cnt: number; due_paise: number }> }).rows
    ?? (result as unknown as Array<{ bucket: string; cnt: number; due_paise: number }>);
  const buckets: AgingRow['bucket'][] = ['0-7', '8-30', '30+'];
  const map = new Map<string, AgingRow>();
  for (const b of buckets)
    map.set(b, { bucket: b, count: 0, totalDuePaise: 0 });
  for (const r of raw ?? []) {
    if (buckets.includes(r.bucket as AgingRow['bucket'])) {
      map.set(r.bucket, {
        bucket: r.bucket as AgingRow['bucket'],
        count: r.cnt,
        totalDuePaise: Number(r.due_paise),
      });
    }
  }
  const rows = buckets.map((b) => map.get(b)!);
  const totalDue = rows.reduce((s, r) => s + r.totalDuePaise, 0);
  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'bucket', label: 'Aging', format: 'string', align: 'left' },
      { key: 'count', label: 'Requests', format: 'number', align: 'right' },
      { key: 'totalDuePaise', label: 'Outstanding (₹)', format: 'currency_paise', align: 'right' },
    ],
    footer: {
      entries: [{ label: 'Total outstanding', value: formatPaise(totalDue) }],
    },
  };
}

void ne;
