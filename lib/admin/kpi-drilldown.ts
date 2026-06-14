import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  quotations,
  requestStatusHistory,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';

import { STATUS_CODES, VISIT_TASK_TYPES } from '@/lib/metrics/constants';
import { formatInrFromPaise } from '@/lib/money';

// =============================================================================
// HVA-292: admin KPI-tile drill-downs
// =============================================================================
//
// The admin dashboard's top tiles (Booked / Visits / Orders / Conversion /
// Productive) show aggregate numbers from the SSOT loaders. These queries
// pull the ACTUAL records behind each tile so clicking a tile lists them,
// org-wide, for the SAME window. Each query MIRRORS its SSOT loader's
// filter (lib/metrics/*) so the list count matches the tile number —
// e.g. orders uses the exact ORDER_CONFIRMED-in-window status-history
// shape, deduped per request (rollback + re-confirm counts once).
//
// Uniform row shape so one table renders every metric. `value` is the
// metric-appropriate trailing cell (rupees / type / converted? / time).
// =============================================================================

export type DrilldownMetric =
  | 'booked'
  | 'orders'
  | 'visits'
  | 'conversion'
  | 'productive';

export const DRILLDOWN_METRICS: readonly DrilldownMetric[] = [
  'booked',
  'orders',
  'visits',
  'conversion',
  'productive',
];

export interface DrilldownRow {
  id: string;
  title: string;
  subtitle: string;
  date: string;
  value: string;
}

export interface DrilldownMeta {
  title: string;
  columns: [string, string, string, string];
}

export const DRILLDOWN_META: Record<DrilldownMetric, DrilldownMeta> = {
  booked: {
    title: 'Booked — confirmed orders',
    columns: ['Customer', 'Exec · City', 'Confirmed', 'Order value'],
  },
  orders: {
    title: 'Orders confirmed',
    columns: ['Customer', 'Exec · City', 'Confirmed', 'Order value'],
  },
  visits: {
    title: 'Visits completed',
    columns: ['Task', 'Executive', 'Date', 'Type'],
  },
  conversion: {
    title: 'Conversion — visited requests',
    columns: ['Customer', 'Exec · City', 'Visit completed', 'Converted?'],
  },
  productive: {
    title: 'Productive — completed tasks',
    columns: ['Task', 'Executive', 'Date', 'Time'],
  },
};

export interface DrilldownInput {
  fromDate: string;
  toDate: string;
  search: string;
  page: number;
  pageSize: number;
}

export interface DrilldownResult {
  rows: DrilldownRow[];
  total: number;
}

const istDate = (col: typeof requestStatusHistory.changedAt) =>
  sql`(${col} AT TIME ZONE 'Asia/Kolkata')::date`;

const minutesExpr = sql<number>`CASE COALESCE(${tasks.actualTime}, ${tasks.estimatedTime})
  WHEN '15min' THEN 15 WHEN '30min' THEN 30 WHEN '1hr' THEN 60
  WHEN '2hr' THEN 120 WHEN '3hr+' THEN 180 ELSE 0 END`;

function minutesLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// --- Confirmed orders (booked + orders share this) -------------------------

async function loadConfirmedOrders(
  i: DrilldownInput,
): Promise<DrilldownResult> {
  const inWindow = and(
    eq(statusStages.code, STATUS_CODES.ORDER_CONFIRMED),
    gte(istDate(requestStatusHistory.changedAt), i.fromDate),
    lte(istDate(requestStatusHistory.changedAt), i.toDate),
  );
  const searchFilter = i.search
    ? or(
        ilike(visitRequests.customerName, `%${i.search}%`),
        ilike(visitRequests.customerPhone, `%${i.search}%`),
      )
    : undefined;

  const [countRow] = await db
    .select({
      n: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(statusStages, eq(statusStages.id, requestStatusHistory.toStatusStageId))
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .where(and(inWindow, searchFilter));

  const rows = await db
    .select({
      id: visitRequests.id,
      customer: visitRequests.customerName,
      execName: users.fullName,
      cityName: cities.name,
      confirmed: sql<string>`MAX(${istDate(requestStatusHistory.changedAt)})`,
      valuePaise: sql<string | null>`(
        SELECT q.total_order_value_paise FROM ${quotations} q
        WHERE q.visit_request_id = ${visitRequests.id} AND q.source = 'portal'
        LIMIT 1
      )`,
    })
    .from(requestStatusHistory)
    .innerJoin(statusStages, eq(statusStages.id, requestStatusHistory.toStatusStageId))
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .leftJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(inWindow, searchFilter))
    .groupBy(visitRequests.id, visitRequests.customerName, users.fullName, cities.name)
    .orderBy(desc(sql`MAX(${istDate(requestStatusHistory.changedAt)})`))
    .limit(i.pageSize)
    .offset((i.page - 1) * i.pageSize);

  return {
    total: countRow?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.customer,
      subtitle: `${r.execName ?? 'Unassigned'} · ${r.cityName ?? '—'}`,
      date: r.confirmed,
      value:
        r.valuePaise != null ? formatInrFromPaise(Number(r.valuePaise)) : '—',
    })),
  };
}

// --- Visited requests (conversion) -----------------------------------------

async function loadVisitedRequests(i: DrilldownInput): Promise<DrilldownResult> {
  const inWindow = and(
    eq(statusStages.code, STATUS_CODES.VISIT_COMPLETED),
    gte(istDate(requestStatusHistory.changedAt), i.fromDate),
    lte(istDate(requestStatusHistory.changedAt), i.toDate),
  );
  const searchFilter = i.search
    ? or(
        ilike(visitRequests.customerName, `%${i.search}%`),
        ilike(visitRequests.customerPhone, `%${i.search}%`),
      )
    : undefined;

  const [countRow] = await db
    .select({
      n: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(statusStages, eq(statusStages.id, requestStatusHistory.toStatusStageId))
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .where(and(inWindow, searchFilter));

  const rows = await db
    .select({
      id: visitRequests.id,
      customer: visitRequests.customerName,
      execName: users.fullName,
      cityName: cities.name,
      visited: sql<string>`MAX(${istDate(requestStatusHistory.changedAt)})`,
      converted: sql<boolean>`EXISTS (
        SELECT 1 FROM ${requestStatusHistory} r2
        INNER JOIN ${statusStages} s2 ON s2.id = r2.to_status_stage_id
        WHERE r2.request_id = ${visitRequests.id}
          AND s2.code = ${STATUS_CODES.ORDER_CONFIRMED}
          AND (r2.changed_at AT TIME ZONE 'Asia/Kolkata')::date >= ${i.fromDate}
          AND (r2.changed_at AT TIME ZONE 'Asia/Kolkata')::date <= ${i.toDate}
      )`,
    })
    .from(requestStatusHistory)
    .innerJoin(statusStages, eq(statusStages.id, requestStatusHistory.toStatusStageId))
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .leftJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(inWindow, searchFilter))
    .groupBy(visitRequests.id, visitRequests.customerName, users.fullName, cities.name)
    .orderBy(desc(sql`MAX(${istDate(requestStatusHistory.changedAt)})`))
    .limit(i.pageSize)
    .offset((i.page - 1) * i.pageSize);

  return {
    total: countRow?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.customer,
      subtitle: `${r.execName ?? 'Unassigned'} · ${r.cityName ?? '—'}`,
      date: r.visited,
      value: r.converted ? 'Converted ✓' : 'Not yet',
    })),
  };
}

// --- Completed tasks (visits + productive) ---------------------------------

async function loadCompletedTasks(
  i: DrilldownInput,
  opts: { visitTypesOnly: boolean; showTime: boolean },
): Promise<DrilldownResult> {
  const filters = and(
    eq(tasks.status, 'completed'),
    gte(tasks.taskDate, i.fromDate),
    lte(tasks.taskDate, i.toDate),
    opts.visitTypesOnly
      ? inArray(
          tasks.taskType,
          VISIT_TASK_TYPES as unknown as readonly (typeof VISIT_TASK_TYPES)[number][],
        )
      : undefined,
    i.search ? ilike(tasks.description, `%${i.search}%`) : undefined,
  );

  const [countRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tasks)
    .where(filters);

  const rows = await db
    .select({
      id: tasks.id,
      description: tasks.description,
      execName: users.fullName,
      taskType: tasks.taskType,
      taskDate: tasks.taskDate,
      minutes: minutesExpr,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.execUserId))
    .where(filters)
    .orderBy(desc(tasks.taskDate))
    .limit(i.pageSize)
    .offset((i.page - 1) * i.pageSize);

  return {
    total: countRow?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.description,
      subtitle: r.execName ?? 'Unassigned',
      date: r.taskDate,
      value: opts.showTime ? minutesLabel(Number(r.minutes)) : r.taskType,
    })),
  };
}

export async function loadKpiDrilldown(
  metric: DrilldownMetric,
  input: DrilldownInput,
): Promise<DrilldownResult> {
  switch (metric) {
    case 'booked':
    case 'orders':
      return loadConfirmedOrders(input);
    case 'conversion':
      return loadVisitedRequests(input);
    case 'visits':
      return loadCompletedTasks(input, { visitTypesOnly: true, showTime: false });
    case 'productive':
      return loadCompletedTasks(input, { visitTypesOnly: false, showTime: true });
  }
}
