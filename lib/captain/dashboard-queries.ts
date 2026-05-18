import { and, asc, desc, eq, gte, inArray, isNull, lte, sql as sqlBuilder } from 'drizzle-orm';

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
  users,
  visitRequests,
} from '@/db/schema';
import { getConfig } from '@/lib/config';
import {
  compareConversionPct,
  compareToTarget,
  type TargetStatus,
} from '@/lib/today/targets';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-80: Captain Dashboard server-side data fetchers
// =============================================================================
//
// HVA-80 extension (PR after #83): every query now accepts a DateFilter so
// the dashboard can render past single dates AND date ranges. The previous
// "today only" behaviour is the `{ mode: 'single', date: <today IST> }`
// default at the page level.
//
// Tractable: aggregates over any window (counts + sums by date column).
// Constrained: "snapshot at end of past date X" — we'd need to find the
// last transition per request as of midnight X. The current implementation
// of pending approvals counts transitions INTO PENDING that LANDED in the
// selected window (= "approvals received during this period"), which is
// the operationally useful metric. Documented in the PR.
//
// TODO: HVA-55 SSE for live updates.
// =============================================================================

const VISIT_TASK_TYPES = [
  'Customer home visit',
  'Sales pitch',
  'Outlet visit',
] as const;

const ORDERS_STAGE_CODES = [
  'ORDER_CONFIRMED',
  'ORDER_EXECUTED_SUCCESSFULLY',
] as const;

// =============================================================================
// Date filter
// =============================================================================

export type DateFilter =
  | { mode: 'single'; date: string } // YYYY-MM-DD
  | { mode: 'range'; from: string; to: string }; // both inclusive, YYYY-MM-DD

export interface ResolvedDateFilter {
  /** Target window — what the dashboard renders metrics FOR. */
  target: { from: string; to: string };
  /** Comparison window — what the delta arrows use. null when comparison isn't computable. */
  compare: { from: string; to: string } | null;
  /** Number of days in the target window (1 for single-date). */
  daysInTarget: number;
  /** Whether traffic lights apply (single-date only per locked decision D3). */
  showTrafficLights: boolean;
  /** Friendly delta label like "vs yesterday" or "vs previous 7 days". */
  comparisonLabel: string;
}

/**
 * Offsets a YYYY-MM-DD by a signed number of days. UTC-anchored to keep
 * the math simple — calendar arithmetic doesn't care about timezone, only
 * the resulting day number.
 */
export function offsetIstDate(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map((s) => Number(s));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + deltaDays);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysBetweenInclusive(from: string, to: string): number {
  const fy = from.split('-').map((s) => Number(s));
  const ty = to.split('-').map((s) => Number(s));
  const a = Date.UTC(fy[0], fy[1] - 1, fy[2]);
  const b = Date.UTC(ty[0], ty[1] - 1, ty[2]);
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1;
}

export function resolveDateFilter(filter: DateFilter): ResolvedDateFilter {
  if (filter.mode === 'single') {
    const target = { from: filter.date, to: filter.date };
    const compare = {
      from: offsetIstDate(filter.date, -1),
      to: offsetIstDate(filter.date, -1),
    };
    return {
      target,
      compare,
      daysInTarget: 1,
      showTrafficLights: true,
      comparisonLabel: 'vs previous day',
    };
  }
  // Range mode.
  const days = daysBetweenInclusive(filter.from, filter.to);
  const compareTo = offsetIstDate(filter.from, -1);
  const compareFrom = offsetIstDate(compareTo, -(days - 1));
  return {
    target: { from: filter.from, to: filter.to },
    compare: { from: compareFrom, to: compareTo },
    daysInTarget: days,
    showTrafficLights: false,
    comparisonLabel: `vs previous ${days} days`,
  };
}

// ---------------------------------------------------------------------------
// Aggregates over an arbitrary window (single date or range)
// ---------------------------------------------------------------------------

interface WindowAggregates {
  revenueRupees: number;
  visitsCompleted: number;
  quotationsCount: number;
  ordersClosed: number;
  taskDone: number;
  taskPostponed: number;
  taskPending: number;
}

async function loadWindowAggregates(args: {
  execIds: readonly string[];
  from: string;
  to: string;
}): Promise<WindowAggregates> {
  const { execIds, from, to } = args;
  if (execIds.length === 0) {
    return {
      revenueRupees: 0,
      visitsCompleted: 0,
      quotationsCount: 0,
      ordersClosed: 0,
      taskDone: 0,
      taskPostponed: 0,
      taskPending: 0,
    };
  }

  const [paymentAgg, taskAgg, quotationAgg, ordersAgg] = await Promise.all([
    db
      .select({
        total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
      })
      .from(payments)
      .where(
        and(
          inArray(payments.recordedByUserId, execIds as string[]),
          gte(payments.paymentDate, from),
          lte(payments.paymentDate, to),
          eq(payments.direction, 'inbound'),
          isNull(payments.voidedAt),
        ),
      ),
    db
      .select({
        status: tasks.status,
        taskType: tasks.taskType,
        count: sqlBuilder<number>`COUNT(*)::int`,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.execUserId, execIds as string[]),
          gte(tasks.taskDate, from),
          lte(tasks.taskDate, to),
        ),
      )
      .groupBy(tasks.status, tasks.taskType),
    db
      .select({ cnt: sqlBuilder<number>`COUNT(*)::int` })
      .from(quotations)
      .where(
        and(
          inArray(quotations.submittedByUserId, execIds as string[]),
          sqlBuilder`${quotations.submittedAt}::date >= ${from}::date`,
          sqlBuilder`${quotations.submittedAt}::date <= ${to}::date`,
        ),
      ),
    db
      .select({
        cnt: sqlBuilder<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
      })
      .from(requestStatusHistory)
      .innerJoin(statusStages, eq(statusStages.id, requestStatusHistory.toStatusStageId))
      .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
      .where(
        and(
          inArray(requestStatusHistory.changedByUserId, execIds as string[]),
          inArray(statusStages.code, ORDERS_STAGE_CODES as readonly string[]),
          sqlBuilder`${requestStatusHistory.changedAt}::date >= ${from}::date`,
          sqlBuilder`${requestStatusHistory.changedAt}::date <= ${to}::date`,
        ),
      ),
  ]);

  const amountCollectedPaise = Number(paymentAgg[0]?.total ?? 0);
  let visitsCompleted = 0;
  let taskDone = 0;
  let taskPostponed = 0;
  let taskPending = 0;
  for (const r of taskAgg) {
    if (r.status === 'completed') {
      taskDone += r.count;
      if (VISIT_TASK_TYPES.includes(r.taskType as (typeof VISIT_TASK_TYPES)[number])) {
        visitsCompleted += r.count;
      }
    } else if (r.status === 'postponed') {
      taskPostponed += r.count;
    } else if (r.status === 'pending') {
      taskPending += r.count;
    }
  }

  return {
    revenueRupees: amountCollectedPaise / 100,
    visitsCompleted,
    quotationsCount: quotationAgg[0]?.cnt ?? 0,
    ordersClosed: ordersAgg[0]?.cnt ?? 0,
    taskDone,
    taskPostponed,
    taskPending,
  };
}

async function loadCaptainTeamIds(captainUserId: string): Promise<string[]> {
  const team = await db
    .select({ id: salesExecutives.userId })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    );
  return team.map((t) => t.id);
}

// ---------------------------------------------------------------------------
// 1. Performance
// ---------------------------------------------------------------------------

export interface PerformanceMetric {
  actual: number | null;
  target: number | null;
  status: TargetStatus;
  /** Comparison-period value at the same metric. null when comparison is missing. */
  previous: number | null;
}

export interface TeamPerformance {
  revenue: PerformanceMetric;
  visits: PerformanceMetric;
  quotations: PerformanceMetric;
  orders: PerformanceMetric;
  conversionPct: PerformanceMetric;
  taskCompletionPct: PerformanceMetric;
  /** Hide traffic-light dots in range mode (D3). */
  showTrafficLights: boolean;
  comparisonLabel: string;
}

export async function loadTeamPerformance(
  captainUserId: string,
  filter: DateFilter,
): Promise<TeamPerformance> {
  const resolved = resolveDateFilter(filter);
  const execIds = await loadCaptainTeamIds(captainUserId);

  const [target, compare, targets] = await Promise.all([
    loadWindowAggregates({ execIds, from: resolved.target.from, to: resolved.target.to }),
    resolved.compare
      ? loadWindowAggregates({
          execIds,
          from: resolved.compare.from,
          to: resolved.compare.to,
        })
      : Promise.resolve(null),
    Promise.all([
      getConfig('target_daily_revenue'),
      getConfig('target_daily_visits'),
      getConfig('target_daily_quotations'),
      getConfig('target_daily_orders'),
      getConfig('target_daily_conversion_pct'),
      getConfig('target_daily_task_completion_pct'),
    ]),
  ]);

  const [
    targetRevenue,
    targetVisits,
    targetQuotations,
    targetOrders,
    targetConversionPct,
    targetTaskCompletionPct,
  ] = targets;

  // For single-date mode the targets apply directly. For range mode the
  // dashboard hides traffic lights (D3), so status defaults to no_target
  // for every cell — the consumer doesn't render the dot anyway.
  const compareToTargetSafe = (actual: number, target: number | null | undefined): TargetStatus =>
    resolved.showTrafficLights ? compareToTarget(actual, target) : 'no_target';

  const denomTarget = target.taskDone + target.taskPostponed + target.taskPending;
  const taskCompletionPctTarget =
    denomTarget === 0 ? null : (target.taskDone / denomTarget) * 100;
  const denomCompare =
    compare === null
      ? null
      : compare.taskDone + compare.taskPostponed + compare.taskPending;
  const taskCompletionPctCompare =
    compare === null || denomCompare === null || denomCompare === 0
      ? null
      : (compare.taskDone / denomCompare) * 100;

  const targetConversion = compareConversionPct(
    target.ordersClosed,
    target.visitsCompleted,
    targetConversionPct,
  );
  const compareConversion =
    compare === null
      ? { actual: null as number | null, status: 'no_target' as TargetStatus }
      : compareConversionPct(
          compare.ordersClosed,
          compare.visitsCompleted,
          targetConversionPct,
        );

  return {
    revenue: {
      actual: target.revenueRupees,
      target: targetRevenue ?? null,
      status: compareToTargetSafe(target.revenueRupees, targetRevenue),
      previous: compare === null ? null : compare.revenueRupees,
    },
    visits: {
      actual: target.visitsCompleted,
      target: targetVisits ?? null,
      status: compareToTargetSafe(target.visitsCompleted, targetVisits),
      previous: compare === null ? null : compare.visitsCompleted,
    },
    quotations: {
      actual: target.quotationsCount,
      target: targetQuotations ?? null,
      status: compareToTargetSafe(target.quotationsCount, targetQuotations),
      previous: compare === null ? null : compare.quotationsCount,
    },
    orders: {
      actual: target.ordersClosed,
      target: targetOrders ?? null,
      status: compareToTargetSafe(target.ordersClosed, targetOrders),
      previous: compare === null ? null : compare.ordersClosed,
    },
    conversionPct: {
      actual: targetConversion.actual,
      target: targetConversionPct ?? null,
      status: resolved.showTrafficLights ? targetConversion.status : 'no_target',
      previous: compareConversion.actual,
    },
    taskCompletionPct: {
      actual: taskCompletionPctTarget,
      target: targetTaskCompletionPct ?? null,
      status:
        !resolved.showTrafficLights || taskCompletionPctTarget === null
          ? 'no_target'
          : compareToTarget(taskCompletionPctTarget, targetTaskCompletionPct),
      previous: taskCompletionPctCompare,
    },
    showTrafficLights: resolved.showTrafficLights,
    comparisonLabel: resolved.comparisonLabel,
  };
}

// ---------------------------------------------------------------------------
// 2. Pending Approvals
// ---------------------------------------------------------------------------
//
// SINGLE-DATE PAST OR RANGE MODE INTERPRETATION:
//   "Approvals received during this window" — count + top-5 of transitions
//   INTO PENDING_CAPTAIN_APPROVAL whose changedAt falls within the window.
//
// TODAY (the default): same logic. The current behaviour from PR #83
// ("currently pending" by status_stage_id snapshot) emerges naturally
// when the window is just today AND none of those have moved out yet.
// For historical windows the "received during" semantic is correct and
// tractable; "still-pending-as-of-EOD-X" would require finding the last
// transition per request as-of X, which is a much heavier query. Flagged
// as a follow-up; PR description documents the divergence.

export interface PendingApprovalRow {
  id: string;
  customerName: string;
  execName: string | null;
  completedAt: Date | null;
}

export async function loadPendingApprovals(
  captainUserId: string,
  filter: DateFilter,
): Promise<{
  totalCount: number;
  topFive: PendingApprovalRow[];
}> {
  const resolved = resolveDateFilter(filter);
  const myCities = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.captainUserId, captainUserId));
  const cityIds = myCities.map((c) => c.id);
  if (cityIds.length === 0) return { totalCount: 0, topFive: [] };

  const [pendingStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
    .limit(1);
  if (!pendingStage) return { totalCount: 0, topFive: [] };

  // For single-day TODAY mode we keep the original "currently pending"
  // semantic — visit_requests still at PENDING_CAPTAIN_APPROVAL,
  // regardless of when they entered the stage. For any other window we
  // use the "received during" semantic via request_status_history.
  const istToday = getIstDateString();
  const isTodaySingle =
    filter.mode === 'single' && filter.date === istToday;

  if (isTodaySingle) {
    const [countRow] = await db
      .select({ cnt: sqlBuilder<number>`COUNT(*)::int` })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.statusStageId, pendingStage.id),
          inArray(visitRequests.cityId, cityIds),
          isNull(visitRequests.cancelledAt),
        ),
      );

    const rows = await db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        execName: users.fullName,
        completedAt: sqlBuilder<Date | null>`(
          SELECT rsh.changed_at FROM request_status_history rsh
          WHERE rsh.request_id = ${visitRequests.id}
            AND rsh.to_status_stage_id = ${pendingStage.id}
          ORDER BY rsh.transition_order DESC
          LIMIT 1
        )`,
      })
      .from(visitRequests)
      .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
      .where(
        and(
          eq(visitRequests.statusStageId, pendingStage.id),
          inArray(visitRequests.cityId, cityIds),
          isNull(visitRequests.cancelledAt),
        ),
      )
      .orderBy(desc(visitRequests.createdAt))
      .limit(5);

    const normalized: PendingApprovalRow[] = rows.map((row) => ({
      id: row.id,
      customerName: row.customerName,
      execName: row.execName,
      completedAt:
        row.completedAt === null
          ? null
          : row.completedAt instanceof Date
            ? row.completedAt
            : new Date(row.completedAt as unknown as string),
    }));
    normalized.sort(
      (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    );

    return { totalCount: countRow?.cnt ?? 0, topFive: normalized };
  }

  // Historical / range path — count distinct request_ids that entered
  // PENDING_CAPTAIN_APPROVAL during the window.
  const transitionRows = await db
    .select({
      requestId: requestStatusHistory.requestId,
      changedAt: requestStatusHistory.changedAt,
      customerName: visitRequests.customerName,
      execName: users.fullName,
    })
    .from(requestStatusHistory)
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .where(
      and(
        eq(requestStatusHistory.toStatusStageId, pendingStage.id),
        inArray(visitRequests.cityId, cityIds),
        sqlBuilder`${requestStatusHistory.changedAt}::date >= ${resolved.target.from}::date`,
        sqlBuilder`${requestStatusHistory.changedAt}::date <= ${resolved.target.to}::date`,
      ),
    )
    .orderBy(desc(requestStatusHistory.changedAt));

  // Distinct by request_id (the same request entering pending twice in the
  // window would otherwise double-count). Keep the most-recent transition.
  const seen = new Set<string>();
  const distinct: PendingApprovalRow[] = [];
  for (const r of transitionRows) {
    if (seen.has(r.requestId)) continue;
    seen.add(r.requestId);
    distinct.push({
      id: r.requestId,
      customerName: r.customerName,
      execName: r.execName,
      completedAt: r.changedAt,
    });
  }
  return { totalCount: distinct.length, topFive: distinct.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// 3. Pending Collections — aging buckets (proxy via quotation.submittedAt)
// ---------------------------------------------------------------------------
//
// Schema gap (carried forward from PR #83):
//   `payments` has no due-date column. Pending = quotation total exceeds
//   sum of inbound non-voided payments. Aging is proxied by
//   `quotation.submittedAt`.
//
// HVA-80 extension semantics:
//   filter.mode='single' or 'range' both restrict the universe to
//   quotations whose submittedAt falls within the target window. The
//   aging-bucket math is ALWAYS relative to NOW (today), per locked
//   decision D3 "Aging buckets still relative to today". The window just
//   narrows which quotations count.

export interface PendingCollectionsSummary {
  totalDueRupees: number;
  buckets: {
    zeroToSeven: number;
    eightToThirty: number;
    thirtyPlus: number;
  };
  outstandingRequestCount: number;
}

export async function loadPendingCollections(
  captainUserId: string,
  filter: DateFilter,
): Promise<PendingCollectionsSummary> {
  const resolved = resolveDateFilter(filter);
  const execIds = await loadCaptainTeamIds(captainUserId);
  if (execIds.length === 0) {
    return {
      totalDueRupees: 0,
      buckets: { zeroToSeven: 0, eightToThirty: 0, thirtyPlus: 0 },
      outstandingRequestCount: 0,
    };
  }

  // Filter semantic (locked decision):
  //   single mode → "as of date X" = all quotations submitted on/before X
  //                  (D2: "quotations submitted ≤ that date")
  //   range mode → "submitted within the window" = both ends inclusive
  //                  (D3: "where quotation.submittedAt is within range")
  const submittedConstraint =
    filter.mode === 'single'
      ? sqlBuilder`${quotations.submittedAt}::date <= ${resolved.target.to}::date`
      : and(
          sqlBuilder`${quotations.submittedAt}::date >= ${resolved.target.from}::date`,
          sqlBuilder`${quotations.submittedAt}::date <= ${resolved.target.to}::date`,
        );

  const rows = await db
    .select({
      visitRequestId: quotations.visitRequestId,
      totalOrderValuePaise: quotations.totalOrderValuePaise,
      submittedAt: quotations.submittedAt,
      paidPaise: sqlBuilder<string | null>`COALESCE((
        SELECT SUM(${payments.amountPaise})::text
        FROM ${payments}
        WHERE ${payments.visitRequestId} = ${quotations.visitRequestId}
          AND ${payments.direction} = 'inbound'
          AND ${payments.voidedAt} IS NULL
      ), '0')`,
    })
    .from(quotations)
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .where(
      and(
        inArray(visitRequests.assignedExecUserId, execIds),
        isNull(visitRequests.cancelledAt),
        submittedConstraint,
      ),
    );

  let totalDuePaise = 0;
  let zeroToSeven = 0;
  let eightToThirty = 0;
  let thirtyPlus = 0;
  let outstandingRequestCount = 0;

  const nowMs = Date.now();
  for (const r of rows) {
    const total = Number(r.totalOrderValuePaise);
    const paid = Number(r.paidPaise ?? 0);
    const due = total - paid;
    if (due <= 0) continue;
    outstandingRequestCount += 1;
    totalDuePaise += due;
    const ageDays = Math.floor(
      (nowMs - r.submittedAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (ageDays <= 7) zeroToSeven += due;
    else if (ageDays <= 30) eightToThirty += due;
    else thirtyPlus += due;
  }

  return {
    totalDueRupees: totalDuePaise / 100,
    buckets: {
      zeroToSeven: zeroToSeven / 100,
      eightToThirty: eightToThirty / 100,
      thirtyPlus: thirtyPlus / 100,
    },
    outstandingRequestCount,
  };
}

// ---------------------------------------------------------------------------
// 4. Team exec status list
// ---------------------------------------------------------------------------
//
// SINGLE-DATE: every exec gets a single status snapshot for THAT date
//   (no_plan / in_progress / closed / unavailable) plus mini-stats from
//   that day.
// RANGE: status is summarised as "{closedCount}/{daysInRange} days closed".
//   Mini-stats sum across the range.

export type ExecDayStatus = 'no_plan' | 'in_progress' | 'closed' | 'unavailable';

export interface TeamExecStatus {
  userId: string;
  fullName: string;
  /** Snapshot status for single-date mode. For range mode, undefined. */
  status?: ExecDayStatus;
  /** Range-mode summary like "5/7 days closed". Undefined in single-date mode. */
  rangeClosedSummary?: { closed: number; total: number };
  visitsToday: number;
  collectionsTodayRupees: number;
  overdueTaskCount: number;
  hasRedFlag: boolean;
  todayTaskBreakdown: {
    pending: number;
    done: number;
    postponed: number;
  };
}

export async function loadTeamExecStatuses(
  captainUserId: string,
  filter: DateFilter,
): Promise<TeamExecStatus[]> {
  const resolved = resolveDateFilter(filter);
  const { from, to } = resolved.target;

  const team = await db
    .select({
      userId: salesExecutives.userId,
      fullName: users.fullName,
      isUnavailable: salesExecutives.isUnavailable,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));

  if (team.length === 0) return [];
  const execIds = team.map((t) => t.userId);

  // Day plans within the window per exec.
  const plans = await db
    .select({
      execUserId: dayPlans.execUserId,
      planDate: dayPlans.planDate,
      closedAt: dayPlans.closedAt,
    })
    .from(dayPlans)
    .where(
      and(
        inArray(dayPlans.execUserId, execIds),
        gte(dayPlans.planDate, from),
        lte(dayPlans.planDate, to),
      ),
    );

  const taskRows = await db
    .select({
      execUserId: tasks.execUserId,
      status: tasks.status,
      taskType: tasks.taskType,
      count: sqlBuilder<number>`COUNT(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.execUserId, execIds),
        gte(tasks.taskDate, from),
        lte(tasks.taskDate, to),
      ),
    )
    .groupBy(tasks.execUserId, tasks.status, tasks.taskType);

  const paymentRows = await db
    .select({
      execUserId: payments.recordedByUserId,
      total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.recordedByUserId, execIds),
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
        eq(payments.direction, 'inbound'),
        isNull(payments.voidedAt),
      ),
    )
    .groupBy(payments.recordedByUserId);
  const collectionsByExec = new Map(
    paymentRows.map((p) => [p.execUserId, Number(p.total ?? 0)]),
  );

  // Overdue is always reference-to-today, regardless of selected window
  // (the flag exists to surface stale postponed tasks RIGHT NOW).
  const istToday = getIstDateString();
  const overdueRows = await db
    .select({
      execUserId: tasks.execUserId,
      count: sqlBuilder<number>`COUNT(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.execUserId, execIds),
        eq(tasks.status, 'postponed'),
        sqlBuilder`${tasks.postponedToDate} < ${istToday}::date`,
      ),
    )
    .groupBy(tasks.execUserId);
  const overdueByExec = new Map(overdueRows.map((r) => [r.execUserId, r.count]));

  const isSingle = filter.mode === 'single';

  const result: TeamExecStatus[] = team.map((t) => {
    const myTasks = taskRows.filter((r) => r.execUserId === t.userId);
    let pending = 0;
    let done = 0;
    let postponed = 0;
    let visits = 0;
    for (const r of myTasks) {
      if (r.status === 'pending') pending += r.count;
      else if (r.status === 'completed') {
        done += r.count;
        if (VISIT_TASK_TYPES.includes(r.taskType as (typeof VISIT_TASK_TYPES)[number])) {
          visits += r.count;
        }
      } else if (r.status === 'postponed') postponed += r.count;
    }

    let status: ExecDayStatus | undefined;
    let rangeClosedSummary: { closed: number; total: number } | undefined;

    if (isSingle) {
      if (t.isUnavailable) {
        status = 'unavailable';
      } else {
        const plan = plans.find(
          (p) => p.execUserId === t.userId && p.planDate === from,
        );
        if (!plan) status = 'no_plan';
        else if (plan.closedAt === null) status = 'in_progress';
        else status = 'closed';
      }
    } else {
      const myPlans = plans.filter((p) => p.execUserId === t.userId);
      const closedCount = myPlans.filter((p) => p.closedAt !== null).length;
      rangeClosedSummary = {
        closed: closedCount,
        total: resolved.daysInTarget,
      };
    }

    const overdueCount = overdueByExec.get(t.userId) ?? 0;
    return {
      userId: t.userId,
      fullName: t.fullName,
      status,
      rangeClosedSummary,
      visitsToday: visits,
      collectionsTodayRupees: (collectionsByExec.get(t.userId) ?? 0) / 100,
      overdueTaskCount: overdueCount,
      hasRedFlag: overdueCount > 0,
      todayTaskBreakdown: { pending, done, postponed },
    };
  });

  result.sort((a, b) => {
    if (b.todayTaskBreakdown.done !== a.todayTaskBreakdown.done) {
      return b.todayTaskBreakdown.done - a.todayTaskBreakdown.done;
    }
    if (b.visitsToday !== a.visitsToday) return b.visitsToday - a.visitsToday;
    return a.fullName.localeCompare(b.fullName);
  });

  return result;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function deltaSign(
  today: number | null,
  yesterday: number | null,
): 'up' | 'down' | 'flat' | 'unknown' {
  if (today === null || yesterday === null) return 'unknown';
  if (today > yesterday) return 'up';
  if (today < yesterday) return 'down';
  return 'flat';
}
