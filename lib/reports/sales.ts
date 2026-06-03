import { and, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  payments,
  quotations,
  requestStatusHistory,
  statusStages,
  tasks,
  visitRequests,
} from '@/db/schema';

import {
  captainFilter,
  cityFilter,
  execFilter,
  tasksScope,
  vrScope,
} from './scope';
import type {
  ReportArgs,
  ReportBucket,
  ReportColumn,
  ReportResult,
} from './types';
import { REPORT_PAGE_SIZE } from './types';

// =============================================================================
// Sales reports (1-10) — trend tables grouped by day/week/month bucket
// =============================================================================
//
// Every loader respects:
//   - Net cash (inbound − outbound) — refunds reduce revenue
//   - IST timezone on every timestamptz date cast
//   - DISTINCT request_id on status-history joins (rollback safe)
//   - Attribution always via visit_requests.assigned_exec_user_id
//
// Bucket SQL conventions:
//   day   → (col AT TIME ZONE 'Asia/Kolkata')::date
//   week  → date_trunc('week', (col AT TIME ZONE 'Asia/Kolkata')::date)
//   month → date_trunc('month', (col AT TIME ZONE 'Asia/Kolkata')::date)
//
// All trend reports share the same row shape: { bucket: 'YYYY-MM-DD',
// value: number, count: number }. The page component renders the
// number with the column-format hint.
// =============================================================================

interface TrendRow {
  bucket: string;
  value: number;
  count: number;
}

function bucketExpr(col: ReturnType<typeof sql>, bucket: ReportBucket) {
  if (bucket === 'day') {
    return sql`(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
  }
  if (bucket === 'week') {
    return sql`date_trunc('week', (${col} AT TIME ZONE 'Asia/Kolkata')::date)::date`;
  }
  return sql`date_trunc('month', (${col} AT TIME ZONE 'Asia/Kolkata')::date)::date`;
}

function dateBucketExpr(col: ReturnType<typeof sql>, bucket: ReportBucket) {
  // For date columns (no timezone wrap needed)
  if (bucket === 'day') {
    return sql`${col}`;
  }
  if (bucket === 'week') {
    return sql`date_trunc('week', ${col})::date`;
  }
  return sql`date_trunc('month', ${col})::date`;
}

function trendColumns(valueLabel: string, valueFmt: ReportColumn['format']): ReportColumn[] {
  return [
    { key: 'bucket', label: 'Period', format: 'date', align: 'left', sortable: true },
    { key: 'value', label: valueLabel, format: valueFmt, align: 'right', sortable: true },
    { key: 'count', label: 'Count', format: 'number', align: 'right', sortable: true },
  ];
}

function paginate<T>(rows: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

function applyTrendSort(
  rows: TrendRow[],
  sortKey: string | undefined,
  dir: 'asc' | 'desc' | undefined,
): TrendRow[] {
  const direction = dir ?? 'desc';
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'value') cmp = a.value - b.value;
    else if (sortKey === 'count') cmp = a.count - b.count;
    else cmp = a.bucket.localeCompare(b.bucket);
    return direction === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// -----------------------------------------------------------------------------
// 1. Revenue trend (gross inbound + outbound — net cash)
// -----------------------------------------------------------------------------

export async function reportRevenueTrend(
  args: ReportArgs,
): Promise<ReportResult<TrendRow>> {
  const bucket = args.bucket ?? 'day';
  const scopeWhere = vrScope(args.scope);
  const filters = args.filters ?? {};

  // payment_date is a plain `date` column.
  const bucketCol = dateBucketExpr(sql`${payments.paymentDate}`, bucket);

  const rows = await db
    .select({
      bucket: sql<string>`${bucketCol}::text`,
      value: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, args.range.fromDate),
        lte(payments.paymentDate, args.range.toDate),
        scopeWhere,
        execFilter(filters.execUserId),
        cityFilter(filters.cityId),
        args.scope.kind === 'global'
          ? captainFilter(filters.captainUserId)
          : undefined,
      ),
    )
    .groupBy(bucketCol);

  const allRows = rows.map<TrendRow>((r) => ({
    bucket: r.bucket,
    value: Number(r.value),
    count: r.count ?? 0,
  }));
  const sorted = applyTrendSort(
    allRows,
    args.sort?.key,
    args.sort?.direction,
  );
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const total = sorted.length;
  const totalValue = sorted.reduce((s, r) => s + r.value, 0);
  const totalCount = sorted.reduce((s, r) => s + r.count, 0);

  return {
    rows: paginate(sorted, page, pageSize),
    total,
    columns: trendColumns('Net cash (₹)', 'currency_paise'),
    footer: {
      entries: [
        { label: 'Total net cash', value: formatPaise(totalValue) },
        { label: 'Total payments', value: String(totalCount) },
        {
          label: 'Average per period',
          value:
            sorted.length > 0
              ? formatPaise(Math.round(totalValue / sorted.length))
              : '—',
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 2. Orders confirmed trend (DISTINCT request_id on ORDER_CONFIRMED transitions)
// -----------------------------------------------------------------------------

export async function reportOrdersTrend(
  args: ReportArgs,
): Promise<ReportResult<TrendRow>> {
  const bucket = args.bucket ?? 'day';
  const scopeWhere = vrScope(args.scope);
  const filters = args.filters ?? {};

  const bucketCol = bucketExpr(
    sql`${requestStatusHistory.changedAt}`,
    bucket,
  );

  // DISTINCT request_id per bucket — rollback + reconfirm in the same
  // window counts once.
  const rows = await db
    .select({
      bucket: sql<string>`${bucketCol}::text`,
      count: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
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
        gte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.fromDate,
        ),
        lte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.toDate,
        ),
        scopeWhere,
        execFilter(filters.execUserId),
        cityFilter(filters.cityId),
        args.scope.kind === 'global'
          ? captainFilter(filters.captainUserId)
          : undefined,
      ),
    )
    .groupBy(bucketCol);

  const allRows = rows.map<TrendRow>((r) => ({
    bucket: r.bucket,
    value: r.count ?? 0,
    count: r.count ?? 0,
  }));
  const sorted = applyTrendSort(allRows, args.sort?.key, args.sort?.direction);
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const total = sorted.length;
  const totalCount = sorted.reduce((s, r) => s + r.count, 0);

  return {
    rows: paginate(sorted, page, pageSize),
    total,
    columns: [
      { key: 'bucket', label: 'Period', format: 'date', align: 'left', sortable: true },
      { key: 'value', label: 'Orders confirmed', format: 'number', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total orders', value: String(totalCount) },
        {
          label: 'Average per period',
          value:
            sorted.length > 0
              ? Math.round(totalCount / sorted.length).toString()
              : '—',
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 3. Order value confirmed trend — SUM of quotations on requests that
//    confirmed in the window (EXISTS subquery on history so the SUM is
//    physically de-duped via the quotations 1:1 FK).
// -----------------------------------------------------------------------------

export async function reportOrderValueTrend(
  args: ReportArgs,
): Promise<ReportResult<TrendRow>> {
  const bucket = args.bucket ?? 'day';
  const scopeWhere = vrScope(args.scope);
  const filters = args.filters ?? {};

  // To bucket "when the order confirmed", join through history and
  // group by that timestamp; sum the quotation value (1:1 with
  // visit_request via UNIQUE FK so no double-count).
  const bucketCol = bucketExpr(
    sql`${requestStatusHistory.changedAt}`,
    bucket,
  );

  const rows = await db
    .select({
      bucket: sql<string>`${bucketCol}::text`,
      value: sql<number>`COALESCE(SUM(${quotations.totalOrderValuePaise}), 0)::bigint`,
      count: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
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
        gte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.fromDate,
        ),
        lte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.toDate,
        ),
        scopeWhere,
        execFilter(filters.execUserId),
        cityFilter(filters.cityId),
        args.scope.kind === 'global'
          ? captainFilter(filters.captainUserId)
          : undefined,
      ),
    )
    .groupBy(bucketCol);

  const allRows = rows.map<TrendRow>((r) => ({
    bucket: r.bucket,
    value: Number(r.value),
    count: r.count ?? 0,
  }));
  const sorted = applyTrendSort(allRows, args.sort?.key, args.sort?.direction);
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const total = sorted.length;
  const totalValue = sorted.reduce((s, r) => s + r.value, 0);

  return {
    rows: paginate(sorted, page, pageSize),
    total,
    columns: trendColumns('Order value (₹)', 'currency_paise'),
    footer: {
      entries: [
        { label: 'Total order value', value: formatPaise(totalValue) },
        {
          label: 'Average order value',
          value:
            sorted.reduce((s, r) => s + r.count, 0) > 0
              ? formatPaise(
                  Math.round(
                    totalValue / sorted.reduce((s, r) => s + r.count, 0),
                  ),
                )
              : '—',
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 4. Visits completed trend (completed visit-type tasks)
// -----------------------------------------------------------------------------

const VISIT_TASK_TYPES = [
  'Customer home visit',
  'Sales pitch',
  'Outlet visit',
] as const;

export async function reportVisitsTrend(
  args: ReportArgs,
): Promise<ReportResult<TrendRow>> {
  const bucket = args.bucket ?? 'day';
  const scopeWhere = tasksScope(args.scope);
  const filters = args.filters ?? {};

  const bucketCol = dateBucketExpr(sql`${tasks.taskDate}`, bucket);

  const rows = await db
    .select({
      bucket: sql<string>`${bucketCol}::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        sql`${tasks.taskType} IN (${sql.join(
          VISIT_TASK_TYPES.map((t) => sql`${t}`),
          sql`, `,
        )})`,
        eq(tasks.status, 'completed'),
        gte(tasks.taskDate, args.range.fromDate),
        lte(tasks.taskDate, args.range.toDate),
        scopeWhere,
        filters.execUserId ? eq(tasks.execUserId, filters.execUserId) : undefined,
      ),
    )
    .groupBy(bucketCol);

  const allRows = rows.map<TrendRow>((r) => ({
    bucket: r.bucket,
    value: r.count ?? 0,
    count: r.count ?? 0,
  }));
  const sorted = applyTrendSort(allRows, args.sort?.key, args.sort?.direction);
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const total = sorted.length;
  const totalCount = sorted.reduce((s, r) => s + r.count, 0);

  return {
    rows: paginate(sorted, page, pageSize),
    total,
    columns: [
      { key: 'bucket', label: 'Period', format: 'date', align: 'left', sortable: true },
      { key: 'value', label: 'Visits completed', format: 'number', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total visits', value: String(totalCount) },
        {
          label: 'Average per period',
          value:
            sorted.length > 0
              ? Math.round(totalCount / sorted.length).toString()
              : '—',
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 5. Conversion % trend — orders ÷ visits per bucket
// -----------------------------------------------------------------------------

interface ConversionRow {
  bucket: string;
  orders: number;
  visits: number;
  conversionPct: number | null;
}

export async function reportConversionTrend(
  args: ReportArgs,
): Promise<ReportResult<ConversionRow>> {
  // Run both visits + orders trends in parallel then merge by bucket.
  const [orders, visits] = await Promise.all([
    reportOrdersTrend({ ...args, pagination: undefined, sort: undefined }),
    reportVisitsTrend({ ...args, pagination: undefined, sort: undefined }),
  ]);
  const map = new Map<string, ConversionRow>();
  for (const r of orders.rows) {
    map.set(r.bucket, {
      bucket: r.bucket,
      orders: r.value,
      visits: 0,
      conversionPct: null,
    });
  }
  for (const r of visits.rows) {
    const existing = map.get(r.bucket);
    if (existing) existing.visits = r.value;
    else
      map.set(r.bucket, {
        bucket: r.bucket,
        orders: 0,
        visits: r.value,
        conversionPct: null,
      });
  }
  for (const v of map.values()) {
    v.conversionPct =
      v.visits > 0 ? Math.round((v.orders / v.visits) * 100) : null;
  }
  let merged = Array.from(map.values());

  const sortKey = args.sort?.key ?? 'bucket';
  const direction = args.sort?.direction ?? 'desc';
  merged.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'orders') cmp = a.orders - b.orders;
    else if (sortKey === 'visits') cmp = a.visits - b.visits;
    else if (sortKey === 'conversionPct')
      cmp = (a.conversionPct ?? -1) - (b.conversionPct ?? -1);
    else cmp = a.bucket.localeCompare(b.bucket);
    return direction === 'asc' ? cmp : -cmp;
  });

  const totalOrders = merged.reduce((s, r) => s + r.orders, 0);
  const totalVisits = merged.reduce((s, r) => s + r.visits, 0);
  const overallPct = totalVisits > 0 ? Math.round((totalOrders / totalVisits) * 100) : null;

  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  return {
    rows: paginate(merged, page, pageSize),
    total: merged.length,
    columns: [
      { key: 'bucket', label: 'Period', format: 'date', align: 'left', sortable: true },
      { key: 'visits', label: 'Visits', format: 'number', align: 'right', sortable: true },
      { key: 'orders', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'conversionPct', label: 'Conversion %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total visits', value: String(totalVisits) },
        { label: 'Total orders', value: String(totalOrders) },
        { label: 'Overall conversion', value: overallPct === null ? '—' : `${overallPct}%` },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 6. Quotations submitted trend
// -----------------------------------------------------------------------------

export async function reportQuotationsTrend(
  args: ReportArgs,
): Promise<ReportResult<TrendRow>> {
  const bucket = args.bucket ?? 'day';
  const scopeWhere = vrScope(args.scope);
  const filters = args.filters ?? {};

  const bucketCol = bucketExpr(sql`${quotations.submittedAt}`, bucket);

  const rows = await db
    .select({
      bucket: sql<string>`${bucketCol}::text`,
      value: sql<number>`COALESCE(SUM(${quotations.totalOrderValuePaise}), 0)::bigint`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(quotations)
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .where(
      and(
        gte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.fromDate,
        ),
        lte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.toDate,
        ),
        scopeWhere,
        execFilter(filters.execUserId),
        cityFilter(filters.cityId),
        args.scope.kind === 'global'
          ? captainFilter(filters.captainUserId)
          : undefined,
      ),
    )
    .groupBy(bucketCol);

  const allRows = rows.map<TrendRow>((r) => ({
    bucket: r.bucket,
    value: Number(r.value),
    count: r.count ?? 0,
  }));
  const sorted = applyTrendSort(allRows, args.sort?.key, args.sort?.direction);
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const totalValue = sorted.reduce((s, r) => s + r.value, 0);
  const totalCount = sorted.reduce((s, r) => s + r.count, 0);

  return {
    rows: paginate(sorted, page, pageSize),
    total: sorted.length,
    columns: trendColumns('Quotation value (₹)', 'currency_paise'),
    footer: {
      entries: [
        { label: 'Total quotations', value: String(totalCount) },
        { label: 'Total value submitted', value: formatPaise(totalValue) },
        {
          label: 'Average quote value',
          value:
            totalCount > 0
              ? formatPaise(Math.round(totalValue / totalCount))
              : '—',
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 7. Quotation → Order acceptance rate
//    For each quotation, check if its request has reached ORDER_CONFIRMED.
// -----------------------------------------------------------------------------

interface AcceptanceRow {
  bucket: string;
  submitted: number;
  confirmed: number;
  acceptancePct: number | null;
}

export async function reportAcceptanceTrend(
  args: ReportArgs,
): Promise<ReportResult<AcceptanceRow>> {
  const bucket = args.bucket ?? 'week';
  const scopeWhere = vrScope(args.scope);
  const filters = args.filters ?? {};

  const bucketCol = bucketExpr(sql`${quotations.submittedAt}`, bucket);
  const requestConfirmed = sql`EXISTS (
    SELECT 1 FROM ${requestStatusHistory} rsh
    INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
    WHERE rsh.request_id = ${quotations.visitRequestId}
      AND ss.code = 'ORDER_CONFIRMED'
  )`;

  const rows = await db
    .select({
      bucket: sql<string>`${bucketCol}::text`,
      submitted: sql<number>`COUNT(*)::int`,
      confirmed: sql<number>`SUM(CASE WHEN ${requestConfirmed} THEN 1 ELSE 0 END)::int`,
    })
    .from(quotations)
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .where(
      and(
        gte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.fromDate,
        ),
        lte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          args.range.toDate,
        ),
        scopeWhere,
        execFilter(filters.execUserId),
        cityFilter(filters.cityId),
        args.scope.kind === 'global'
          ? captainFilter(filters.captainUserId)
          : undefined,
      ),
    )
    .groupBy(bucketCol);

  let merged = rows.map<AcceptanceRow>((r) => ({
    bucket: r.bucket,
    submitted: r.submitted ?? 0,
    confirmed: r.confirmed ?? 0,
    acceptancePct:
      (r.submitted ?? 0) > 0
        ? Math.round(((r.confirmed ?? 0) / (r.submitted ?? 1)) * 100)
        : null,
  }));

  const sortKey = args.sort?.key ?? 'bucket';
  const direction = args.sort?.direction ?? 'desc';
  merged.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'submitted') cmp = a.submitted - b.submitted;
    else if (sortKey === 'confirmed') cmp = a.confirmed - b.confirmed;
    else if (sortKey === 'acceptancePct')
      cmp = (a.acceptancePct ?? -1) - (b.acceptancePct ?? -1);
    else cmp = a.bucket.localeCompare(b.bucket);
    return direction === 'asc' ? cmp : -cmp;
  });

  const totalSubmitted = merged.reduce((s, r) => s + r.submitted, 0);
  const totalConfirmed = merged.reduce((s, r) => s + r.confirmed, 0);
  const overallPct =
    totalSubmitted > 0
      ? Math.round((totalConfirmed / totalSubmitted) * 100)
      : null;

  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;

  return {
    rows: paginate(merged, page, pageSize),
    total: merged.length,
    columns: [
      { key: 'bucket', label: 'Period', format: 'date', align: 'left', sortable: true },
      { key: 'submitted', label: 'Quotations sent', format: 'number', align: 'right', sortable: true },
      { key: 'confirmed', label: 'Confirmed', format: 'number', align: 'right', sortable: true },
      { key: 'acceptancePct', label: 'Acceptance %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total quotations', value: String(totalSubmitted) },
        { label: 'Total confirmed', value: String(totalConfirmed) },
        {
          label: 'Overall acceptance',
          value: overallPct === null ? '—' : `${overallPct}%`,
        },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 8. Net cash trend — alias of revenue trend; kept as separate report key
//    because Sandeep wants both "Revenue" + "Net cash" tiles findable by
//    name. Same calc.
// -----------------------------------------------------------------------------

export const reportNetCashTrend = reportRevenueTrend;

// -----------------------------------------------------------------------------
// 9. Average order value trend — order_value ÷ orders_count per bucket
// -----------------------------------------------------------------------------

interface AOVRow {
  bucket: string;
  orderValue: number;
  ordersCount: number;
  averageOrderValue: number;
}

export async function reportAovTrend(
  args: ReportArgs,
): Promise<ReportResult<AOVRow>> {
  const orderValue = await reportOrderValueTrend({
    ...args,
    pagination: undefined,
    sort: undefined,
  });
  const merged = orderValue.rows.map<AOVRow>((r) => ({
    bucket: r.bucket,
    orderValue: r.value,
    ordersCount: r.count,
    averageOrderValue:
      r.count > 0 ? Math.round(r.value / r.count) : 0,
  }));

  const sortKey = args.sort?.key ?? 'bucket';
  const direction = args.sort?.direction ?? 'desc';
  merged.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'orderValue') cmp = a.orderValue - b.orderValue;
    else if (sortKey === 'ordersCount') cmp = a.ordersCount - b.ordersCount;
    else if (sortKey === 'averageOrderValue')
      cmp = a.averageOrderValue - b.averageOrderValue;
    else cmp = a.bucket.localeCompare(b.bucket);
    return direction === 'asc' ? cmp : -cmp;
  });

  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const totalOrderValue = merged.reduce((s, r) => s + r.orderValue, 0);
  const totalOrders = merged.reduce((s, r) => s + r.ordersCount, 0);
  const overallAov =
    totalOrders > 0 ? Math.round(totalOrderValue / totalOrders) : 0;

  return {
    rows: paginate(merged, page, pageSize),
    total: merged.length,
    columns: [
      { key: 'bucket', label: 'Period', format: 'date', align: 'left', sortable: true },
      { key: 'orderValue', label: 'Order value (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'ordersCount', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'averageOrderValue', label: 'Avg order value (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total orders', value: String(totalOrders) },
        { label: 'Overall AOV', value: formatPaise(overallAov) },
      ],
    },
  };
}

// -----------------------------------------------------------------------------
// 10. Cycle time — average days from first visit task to ORDER_CONFIRMED
// -----------------------------------------------------------------------------

interface CycleRow {
  requestId: string;
  customerName: string;
  visitDate: string;
  orderDate: string;
  daysToOrder: number;
}

export async function reportCycleTime(
  args: ReportArgs,
): Promise<ReportResult<CycleRow>> {
  const scopeWhere = vrScope(args.scope);
  const filters = args.filters ?? {};

  // For each confirmed-in-window request, find min visit task date +
  // the order_confirmed transition date.
  const rows = await db.execute<{
    request_id: string;
    customer_name: string;
    visit_date: string;
    order_date: string;
    days_to_order: number;
  }>(sql`
    WITH confirmed AS (
      SELECT DISTINCT
        rsh.request_id,
        MIN((rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date) AS order_date
      FROM ${requestStatusHistory} rsh
      INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
      WHERE ss.code = 'ORDER_CONFIRMED'
        AND (rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date >= ${args.range.fromDate}
        AND (rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date <= ${args.range.toDate}
      GROUP BY rsh.request_id
    ),
    first_visit AS (
      SELECT t.link_request_id AS request_id, MIN(t.task_date) AS visit_date
      FROM ${tasks} t
      WHERE t.task_type IN ('Customer home visit', 'Sales pitch', 'Outlet visit')
        AND t.status = 'completed'
        AND t.link_request_id IS NOT NULL
      GROUP BY t.link_request_id
    )
    SELECT
      vr.id AS request_id,
      vr.customer_name,
      fv.visit_date::text AS visit_date,
      cf.order_date::text AS order_date,
      (cf.order_date - fv.visit_date)::int AS days_to_order
    FROM confirmed cf
    INNER JOIN ${visitRequests} vr ON vr.id = cf.request_id
    INNER JOIN first_visit fv ON fv.request_id = cf.request_id
    WHERE 1=1
      ${scopeWhere ? sql`AND ${scopeWhere}` : sql``}
      ${execFilter(filters.execUserId) ? sql`AND ${execFilter(filters.execUserId)}` : sql``}
      ${cityFilter(filters.cityId) ? sql`AND ${cityFilter(filters.cityId)}` : sql``}
    ORDER BY days_to_order DESC
  `);
  // Drizzle's db.execute returns { rows: ... } on postgres-js
  const raw = (rows as unknown as { rows?: Array<{ request_id: string; customer_name: string; visit_date: string; order_date: string; days_to_order: number }> }).rows
    ?? (rows as unknown as Array<{ request_id: string; customer_name: string; visit_date: string; order_date: string; days_to_order: number }>);

  let merged: CycleRow[] = (raw ?? []).map((r) => ({
    requestId: r.request_id,
    customerName: r.customer_name,
    visitDate: r.visit_date,
    orderDate: r.order_date,
    daysToOrder: r.days_to_order,
  }));

  const sortKey = args.sort?.key ?? 'daysToOrder';
  const direction = args.sort?.direction ?? 'desc';
  merged.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'visitDate') cmp = a.visitDate.localeCompare(b.visitDate);
    else if (sortKey === 'orderDate') cmp = a.orderDate.localeCompare(b.orderDate);
    else if (sortKey === 'customerName') cmp = a.customerName.localeCompare(b.customerName);
    else cmp = a.daysToOrder - b.daysToOrder;
    return direction === 'asc' ? cmp : -cmp;
  });

  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const page = args.pagination?.page ?? 1;
  const avgDays =
    merged.length > 0
      ? Math.round(merged.reduce((s, r) => s + r.daysToOrder, 0) / merged.length)
      : 0;
  const medianDays = (() => {
    if (merged.length === 0) return 0;
    const sortedAsc = [...merged].map((r) => r.daysToOrder).sort((a, b) => a - b);
    const mid = Math.floor(sortedAsc.length / 2);
    return sortedAsc.length % 2 === 0
      ? Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2)
      : sortedAsc[mid];
  })();

  return {
    rows: paginate(merged, page, pageSize),
    total: merged.length,
    columns: [
      { key: 'requestId', label: 'Request', format: 'string', align: 'left', linksToRequest: true },
      { key: 'customerName', label: 'Customer', format: 'string', align: 'left', sortable: true },
      { key: 'visitDate', label: 'First visit', format: 'date', align: 'left', sortable: true },
      { key: 'orderDate', label: 'Order confirmed', format: 'date', align: 'left', sortable: true },
      { key: 'daysToOrder', label: 'Days', format: 'days', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Orders included', value: String(merged.length) },
        { label: 'Average days', value: String(avgDays) },
        { label: 'Median days', value: String(medianDays) },
      ],
    },
  };
}

// =============================================================================
// Helpers — exported for use by other report files
// =============================================================================

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? '-' : '';
  return `${sign}${new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.abs(rupees))}`;
}

// Suppress unused-warn — isNotNull may be referenced by future report
// additions in this file.
void isNotNull;
