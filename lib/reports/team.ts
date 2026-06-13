import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';

import { formatPaise } from './sales';
import { captainFilter, cityFilter, vrScope } from './scope';
import type { ReportArgs, ReportResult } from './types';
import { REPORT_PAGE_SIZE } from './types';

// =============================================================================
// Team / Executive reports (Sprint 2, reports 11-18)
// =============================================================================
//
// Per-exec aggregates over the date range. Each row = one exec; the
// caller can filter to a captain (cross-team comparison disabled) or
// a city. Sort + pagination identical to other reports.
//
// SSOT calc discipline:
//   - Revenue = net inbound − outbound (refunds reduce)
//   - Orders = DISTINCT request_id on ORDER_CONFIRMED in window
//   - Visits = completed visit-type tasks
//   - Attribution always via visit_requests.assigned_exec_user_id
// =============================================================================

const VISIT_TASK_TYPES = ['Customer home visit', 'Sales pitch', 'Outlet visit'] as const;

interface ExecAggRow {
  execUserId: string;
  execName: string;
  captainName: string | null;
  cityName: string | null;
  revenuePaise: number;
  ordersCount: number;
  orderValuePaise: number;
  visits: number;
  quotationsCount: number;
  quotationsValuePaise: number;
  conversionPct: number | null;
  taskCompletionPct: number | null;
  productiveMinutes: number;
  contactsCaptured: number;
}

function paginate<T>(rows: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

function applySort(
  rows: ExecAggRow[],
  key: string | undefined,
  dir: 'asc' | 'desc' | undefined,
): ExecAggRow[] {
  const sortKey = (key ?? 'revenuePaise') as keyof ExecAggRow;
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

/** Internal: pull every active exec in scope + their aggregates over
 *  the range. Used by reports 11-18. */
async function loadExecAggregates(args: ReportArgs): Promise<ExecAggRow[]> {
  const filters = args.filters ?? {};
  const { fromDate, toDate } = args.range;

  // First, resolve the exec roster (scope + filter).
  const team = await db
    .select({
      execUserId: salesExecutives.userId,
      execName: users.fullName,
      captainUserId: salesExecutives.captainUserId,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(users.isActive, true),
        args.scope.kind === 'captain'
          ? eq(salesExecutives.captainUserId, args.scope.captainUserId)
          : args.scope.kind === 'exec'
            ? eq(salesExecutives.userId, args.scope.execUserId)
            : filters.captainUserId
              ? eq(salesExecutives.captainUserId, filters.captainUserId)
              : undefined,
        filters.cityId ? eq(salesExecutives.cityId, filters.cityId) : undefined,
        filters.execUserId
          ? eq(salesExecutives.userId, filters.execUserId)
          : undefined,
      ),
    )
    .orderBy(asc(users.fullName));

  if (team.length === 0) return [];
  const execIds = team.map((t) => t.execUserId);

  // Captain names map
  const captainIds = Array.from(
    new Set(team.map((t) => t.captainUserId).filter(Boolean)),
  ) as string[];
  const captainNameMap = new Map<string, string>();
  if (captainIds.length > 0) {
    const captains = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, captainIds));
    for (const c of captains) captainNameMap.set(c.id, c.name ?? '');
  }

  // Per-exec aggregates — four parallel sub-queries grouped by exec.
  const [paymentAgg, taskAgg, ordersAgg, quotationsAgg, contactsAgg] =
    await Promise.all([
      // Revenue (net cash) + payment count
      db
        .select({
          execUserId: visitRequests.assignedExecUserId,
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
            isNull(payments.voidedAt),
            gte(payments.paymentDate, fromDate),
            lte(payments.paymentDate, toDate),
            inArray(visitRequests.assignedExecUserId, execIds),
          ),
        )
        .groupBy(visitRequests.assignedExecUserId),
      // Tasks — both visit count + task-completion% need this
      db
        .select({
          execUserId: tasks.execUserId,
          status: tasks.status,
          taskType: tasks.taskType,
          count: sql<number>`COUNT(*)::int`,
          minutes: sql<number>`COALESCE(SUM(
            CASE COALESCE(${tasks.actualTime}, ${tasks.estimatedTime})
              WHEN '15min' THEN 15
              WHEN '30min' THEN 30
              WHEN '1hr'   THEN 60
              WHEN '2hr'   THEN 120
              WHEN '3hr+'  THEN 180
              ELSE 0
            END
          ), 0)::int`,
        })
        .from(tasks)
        .where(
          and(
            inArray(tasks.execUserId, execIds),
            gte(tasks.taskDate, fromDate),
            lte(tasks.taskDate, toDate),
          ),
        )
        .groupBy(tasks.execUserId, tasks.status, tasks.taskType),
      // Orders confirmed (DISTINCT request_id)
      db
        .select({
          execUserId: visitRequests.assignedExecUserId,
          count: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
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
          and(
            eq(quotations.visitRequestId, requestStatusHistory.requestId),
            // HVA-281: CartPlus actuals only.
            eq(quotations.source, 'portal'),
          ),
        )
        .where(
          and(
            eq(statusStages.code, 'ORDER_CONFIRMED'),
            gte(
              sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
              fromDate,
            ),
            lte(
              sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
              toDate,
            ),
            inArray(visitRequests.assignedExecUserId, execIds),
          ),
        )
        .groupBy(visitRequests.assignedExecUserId),
      // Quotations submitted
      db
        .select({
          execUserId: visitRequests.assignedExecUserId,
          count: sql<number>`COUNT(*)::int`,
          valuePaise: sql<number>`COALESCE(SUM(${quotations.totalOrderValuePaise}), 0)::bigint`,
        })
        .from(quotations)
        .innerJoin(
          visitRequests,
          eq(visitRequests.id, quotations.visitRequestId),
        )
        .where(
          and(
            // HVA-281: CartPlus actuals only.
            eq(quotations.source, 'portal'),
            inArray(visitRequests.assignedExecUserId, execIds),
            gte(
              sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
              fromDate,
            ),
            lte(
              sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
              toDate,
            ),
          ),
        )
        .groupBy(visitRequests.assignedExecUserId),
      // Contacts captured — leads.captured_by_user_id
      db.execute<{ exec_user_id: string; cnt: number }>(sql`
        SELECT captured_by_user_id::text AS exec_user_id, COUNT(*)::int AS cnt
        FROM leads
        WHERE captured_by_user_id IN (${sql.join(
          execIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${fromDate}
          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${toDate}
        GROUP BY captured_by_user_id
      `),
    ]);

  // Build per-exec maps
  const revByExec = new Map<string, number>();
  for (const r of paymentAgg) {
    if (r.execUserId) revByExec.set(r.execUserId, Number(r.netPaise));
  }
  const ordersByExec = new Map<string, { count: number; value: number }>();
  for (const r of ordersAgg) {
    if (r.execUserId)
      ordersByExec.set(r.execUserId, {
        count: r.count,
        value: Number(r.valuePaise),
      });
  }
  const quotByExec = new Map<string, { count: number; value: number }>();
  for (const r of quotationsAgg) {
    if (r.execUserId)
      quotByExec.set(r.execUserId, {
        count: r.count,
        value: Number(r.valuePaise),
      });
  }

  // Tasks: build visits count + completion% + productive minutes
  type TaskAcc = {
    completed: number;
    pending: number;
    postponed: number;
    visits: number;
    minutes: number;
  };
  const taskAcc = new Map<string, TaskAcc>();
  for (const r of taskAgg) {
    const acc = taskAcc.get(r.execUserId) ?? {
      completed: 0,
      pending: 0,
      postponed: 0,
      visits: 0,
      minutes: 0,
    };
    if (r.status === 'completed') acc.completed += r.count;
    if (r.status === 'pending') acc.pending += r.count;
    if (r.status === 'postponed') acc.postponed += r.count;
    if (r.status === 'completed' && VISIT_TASK_TYPES.includes(r.taskType as never)) {
      acc.visits += r.count;
    }
    if (r.status === 'completed') acc.minutes += r.minutes;
    taskAcc.set(r.execUserId, acc);
  }

  const contactsByExec = new Map<string, number>();
  const contactsRows =
    (contactsAgg as unknown as { rows?: Array<{ exec_user_id: string; cnt: number }> }).rows
    ?? (contactsAgg as unknown as Array<{ exec_user_id: string; cnt: number }>);
  for (const r of contactsRows ?? []) {
    contactsByExec.set(r.exec_user_id, r.cnt);
  }

  // City name map (one query — execs per city)
  const cityRows = await db
    .select({
      execUserId: salesExecutives.userId,
      cityId: salesExecutives.cityId,
    })
    .from(salesExecutives)
    .where(inArray(salesExecutives.userId, execIds));
  const cityIds = Array.from(
    new Set(cityRows.map((r) => r.cityId).filter(Boolean)),
  ) as string[];
  const cityNameMap = new Map<string, string>();
  if (cityIds.length > 0) {
    const cityNames = await db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name FROM cities WHERE id IN (${sql.join(
        cityIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    `);
    const rows =
      (cityNames as unknown as { rows?: Array<{ id: string; name: string }> }).rows
      ?? (cityNames as unknown as Array<{ id: string; name: string }>);
    for (const c of rows ?? []) cityNameMap.set(c.id, c.name);
  }
  const cityByExec = new Map<string, string | null>();
  for (const r of cityRows) {
    cityByExec.set(r.execUserId, r.cityId ? cityNameMap.get(r.cityId) ?? null : null);
  }

  return team.map<ExecAggRow>((t) => {
    const orders = ordersByExec.get(t.execUserId) ?? { count: 0, value: 0 };
    const quot = quotByExec.get(t.execUserId) ?? { count: 0, value: 0 };
    const tk = taskAcc.get(t.execUserId) ?? {
      completed: 0,
      pending: 0,
      postponed: 0,
      visits: 0,
      minutes: 0,
    };
    const visits = tk.visits;
    const totalTasks = tk.completed + tk.pending + tk.postponed;
    return {
      execUserId: t.execUserId,
      execName: t.execName ?? '(unnamed)',
      captainName: t.captainUserId
        ? captainNameMap.get(t.captainUserId) ?? null
        : null,
      cityName: cityByExec.get(t.execUserId) ?? null,
      revenuePaise: revByExec.get(t.execUserId) ?? 0,
      ordersCount: orders.count,
      orderValuePaise: orders.value,
      visits,
      quotationsCount: quot.count,
      quotationsValuePaise: quot.value,
      conversionPct: visits > 0 ? Math.round((orders.count / visits) * 100) : null,
      taskCompletionPct:
        totalTasks > 0 ? Math.round((tk.completed / totalTasks) * 100) : null,
      productiveMinutes: tk.minutes,
      contactsCaptured: contactsByExec.get(t.execUserId) ?? 0,
    };
  });
}

function paginatedRows(
  args: ReportArgs,
  rows: ExecAggRow[],
): ReportResult<ExecAggRow>['rows'] {
  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return paginate(rows, page, pageSize);
}

const COMMON_COLUMNS = {
  exec: {
    key: 'execName',
    label: 'Executive',
    format: 'string' as const,
    align: 'left' as const,
    sortable: true,
  },
  city: {
    key: 'cityName',
    label: 'City',
    format: 'string' as const,
    align: 'left' as const,
    sortable: true,
  },
  captain: {
    key: 'captainName',
    label: 'Captain',
    format: 'string' as const,
    align: 'left' as const,
    sortable: true,
  },
};

function totalsFooter(
  rows: ExecAggRow[],
): ReportResult<ExecAggRow>['footer'] {
  const revenue = rows.reduce((s, r) => s + r.revenuePaise, 0);
  const orders = rows.reduce((s, r) => s + r.ordersCount, 0);
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  return {
    entries: [
      { label: 'Total revenue', value: formatPaise(revenue) },
      { label: 'Total orders', value: String(orders) },
      { label: 'Total visits', value: String(visits) },
      {
        label: 'Overall conversion',
        value: visits > 0 ? `${Math.round((orders / visits) * 100)}%` : '—',
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// 11. Per-exec revenue leaderboard
// -----------------------------------------------------------------------------

export async function reportExecRevenue(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'revenuePaise', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'revenuePaise', label: 'Revenue (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 12. Per-exec orders count + value
// -----------------------------------------------------------------------------

export async function reportExecOrders(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'ordersCount', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'ordersCount', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'orderValuePaise', label: 'Order value (₹)', format: 'currency_paise', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 13. Per-exec visit count
// -----------------------------------------------------------------------------

export async function reportExecVisits(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'visits', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'visits', label: 'Visits completed', format: 'number', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 14. Per-exec conversion %
// -----------------------------------------------------------------------------

export async function reportExecConversion(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'conversionPct', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'visits', label: 'Visits', format: 'number', align: 'right', sortable: true },
      { key: 'ordersCount', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'conversionPct', label: 'Conversion %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 15. Per-exec task completion %
// -----------------------------------------------------------------------------

export async function reportExecTaskCompletion(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'taskCompletionPct', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'taskCompletionPct', label: 'Tasks done %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 16. Per-exec productive minutes
// -----------------------------------------------------------------------------

export async function reportExecProductive(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'productiveMinutes', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'productiveMinutes', label: 'Productive minutes', format: 'number', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 17. Per-exec contacts captured
// -----------------------------------------------------------------------------

export async function reportExecContacts(
  args: ReportArgs,
): Promise<ReportResult<ExecAggRow>> {
  let rows = await loadExecAggregates(args);
  rows = applySort(rows, args.sort?.key ?? 'contactsCaptured', args.sort?.direction ?? 'desc');
  return {
    rows: paginatedRows(args, rows),
    total: rows.length,
    columns: [
      COMMON_COLUMNS.exec,
      COMMON_COLUMNS.captain,
      COMMON_COLUMNS.city,
      { key: 'contactsCaptured', label: 'New contacts', format: 'number', align: 'right', sortable: true },
    ],
    footer: totalsFooter(rows),
  };
}

// -----------------------------------------------------------------------------
// 18. Per-captain team rollup
// -----------------------------------------------------------------------------

interface CaptainAggRow {
  captainUserId: string;
  captainName: string;
  execCount: number;
  revenuePaise: number;
  ordersCount: number;
  orderValuePaise: number;
  visits: number;
  contactsCaptured: number;
}

export async function reportCaptainRollup(
  args: ReportArgs,
): Promise<ReportResult<CaptainAggRow>> {
  // Reuse the exec aggregator (broadened to all captains' execs in
  // scope) and bucket by captain.
  const execRows = await loadExecAggregates({
    ...args,
    scope: { kind: 'global' },
    filters: { ...(args.filters ?? {}), captainUserId: undefined },
  });
  // We need the captainUserId per exec row — the aggregator returns
  // captainName but not id. Re-fetch a tiny mapping.
  const captainMap = new Map<string, { id: string; name: string }>();
  if (execRows.length > 0) {
    const execIds = execRows.map((r) => r.execUserId);
    const captains = await db
      .select({
        execUserId: salesExecutives.userId,
        captainUserId: salesExecutives.captainUserId,
        captainName: users.fullName,
      })
      .from(salesExecutives)
      .innerJoin(users, eq(users.id, salesExecutives.captainUserId))
      .where(inArray(salesExecutives.userId, execIds));
    for (const c of captains) {
      if (c.captainUserId) {
        captainMap.set(c.execUserId, {
          id: c.captainUserId,
          name: c.captainName ?? '',
        });
      }
    }
  }

  const rollup = new Map<string, CaptainAggRow>();
  for (const exec of execRows) {
    const cap = captainMap.get(exec.execUserId);
    if (!cap) continue;
    const acc = rollup.get(cap.id) ?? {
      captainUserId: cap.id,
      captainName: cap.name,
      execCount: 0,
      revenuePaise: 0,
      ordersCount: 0,
      orderValuePaise: 0,
      visits: 0,
      contactsCaptured: 0,
    };
    acc.execCount += 1;
    acc.revenuePaise += exec.revenuePaise;
    acc.ordersCount += exec.ordersCount;
    acc.orderValuePaise += exec.orderValuePaise;
    acc.visits += exec.visits;
    acc.contactsCaptured += exec.contactsCaptured;
    rollup.set(cap.id, acc);
  }

  let rows = Array.from(rollup.values());
  const sortKey = args.sort?.key ?? 'revenuePaise';
  const dir = args.sort?.direction ?? 'desc';
  rows.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  const totalRevenue = rows.reduce((s, r) => s + r.revenuePaise, 0);
  const totalOrders = rows.reduce((s, r) => s + r.ordersCount, 0);

  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    columns: [
      { key: 'captainName', label: 'Captain', format: 'string', align: 'left', sortable: true },
      { key: 'execCount', label: 'Team size', format: 'number', align: 'right', sortable: true },
      { key: 'revenuePaise', label: 'Revenue (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'ordersCount', label: 'Orders', format: 'number', align: 'right', sortable: true },
      { key: 'orderValuePaise', label: 'Order value (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'visits', label: 'Visits', format: 'number', align: 'right', sortable: true },
      { key: 'contactsCaptured', label: 'Contacts', format: 'number', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Total revenue', value: formatPaise(totalRevenue) },
        { label: 'Total orders', value: String(totalOrders) },
        {
          label: 'Captains active',
          value: String(rows.length),
        },
      ],
    },
  };
}

// Silence unused-import warnings — exposed so future report adds can use them.
void vrScope;
void cityFilter;
void captainFilter;
