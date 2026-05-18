import { and, asc, desc, eq, inArray, isNull, sql as sqlBuilder } from 'drizzle-orm';

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
// Four query groups, all scoped by the captain's team (every exec where
// salesExecutives.captainUserId = currentCaptainId):
//
//   1. loadTeamPerformance — 6-metric aggregate for today + yesterday's
//      same metrics for the delta arrow.
//   2. loadPendingApprovals — top-5 visit_requests at PENDING_CAPTAIN_APPROVAL
//      in the captain's cities.
//   3. loadPendingCollections — open quotations where total > paid, bucketed
//      by quotation.submittedAt age (proxy for "due date" — schema lacks an
//      explicit due_date column; documented spec gap).
//   4. loadTeamExecStatuses — one row per exec on the captain's team with
//      live day-plan status + mini-stats.
//
// SSE / live updates are HVA-55 territory — not in this ship. Page refreshes
// on captain's own mutations via router.refresh; cross-actor updates require
// manual refresh.
//
// Spec gaps documented inline where the schema doesn't match HVA-80's text.
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

// ---------------------------------------------------------------------------
// 1. Performance (today + yesterday delta)
// ---------------------------------------------------------------------------

export interface PerformanceMetric {
  actual: number | null;
  target: number | null;
  status: TargetStatus;
  /** Yesterday's value at the same metric. null when yesterday has no data. */
  previous: number | null;
}

export interface TeamPerformance {
  revenue: PerformanceMetric;
  visits: PerformanceMetric;
  quotations: PerformanceMetric;
  orders: PerformanceMetric;
  conversionPct: PerformanceMetric;
  taskCompletionPct: PerformanceMetric;
}

function yesterdayIstDateString(istToday: string): string {
  // istToday is YYYY-MM-DD. Roll back one day via Date math; output the
  // string form. Time-of-day doesn't matter for the date arithmetic.
  const [y, m, d] = istToday.split('-').map((s) => Number(s));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - 1);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function loadDailyAggregates(args: {
  execIds: readonly string[];
  istDate: string;
}): Promise<{
  revenueRupees: number;
  visitsCompleted: number;
  quotationsCount: number;
  ordersClosed: number;
  taskDone: number;
  taskPostponed: number;
  taskPending: number;
}> {
  const { execIds, istDate } = args;
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

  // Run the four aggregates in parallel. Each is a single SQL round-trip.
  const [paymentAgg, taskAgg, quotationAgg, ordersAgg] = await Promise.all([
    db
      .select({
        total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
      })
      .from(payments)
      .where(
        and(
          inArray(payments.recordedByUserId, execIds as string[]),
          eq(payments.paymentDate, istDate),
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
          eq(tasks.taskDate, istDate),
        ),
      )
      .groupBy(tasks.status, tasks.taskType),
    db
      .select({
        cnt: sqlBuilder<number>`COUNT(*)::int`,
      })
      .from(quotations)
      .where(
        and(
          inArray(quotations.submittedByUserId, execIds as string[]),
          sqlBuilder`${quotations.submittedAt}::date = ${istDate}::date`,
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
          sqlBuilder`${requestStatusHistory.changedAt}::date = ${istDate}::date`,
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
      if (
        VISIT_TASK_TYPES.includes(
          r.taskType as (typeof VISIT_TASK_TYPES)[number],
        )
      ) {
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

export async function loadTeamPerformance(captainUserId: string): Promise<TeamPerformance> {
  const istToday = getIstDateString();
  const istYesterday = yesterdayIstDateString(istToday);

  // Resolve the captain's team — list of exec user ids that report to me.
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
  const execIds = team.map((t) => t.id);

  const [today, yesterday, targets] = await Promise.all([
    loadDailyAggregates({ execIds, istDate: istToday }),
    loadDailyAggregates({ execIds, istDate: istYesterday }),
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

  const denomToday = today.taskDone + today.taskPostponed + today.taskPending;
  const taskCompletionPctToday =
    denomToday === 0 ? null : (today.taskDone / denomToday) * 100;
  const denomYesterday =
    yesterday.taskDone + yesterday.taskPostponed + yesterday.taskPending;
  const taskCompletionPctYesterday =
    denomYesterday === 0
      ? null
      : (yesterday.taskDone / denomYesterday) * 100;

  const todayConversion = compareConversionPct(
    today.ordersClosed,
    today.visitsCompleted,
    targetConversionPct,
  );
  const yesterdayConversion = compareConversionPct(
    yesterday.ordersClosed,
    yesterday.visitsCompleted,
    targetConversionPct,
  );

  return {
    revenue: {
      actual: today.revenueRupees,
      target: targetRevenue ?? null,
      status: compareToTarget(today.revenueRupees, targetRevenue),
      previous: yesterday.revenueRupees,
    },
    visits: {
      actual: today.visitsCompleted,
      target: targetVisits ?? null,
      status: compareToTarget(today.visitsCompleted, targetVisits),
      previous: yesterday.visitsCompleted,
    },
    quotations: {
      actual: today.quotationsCount,
      target: targetQuotations ?? null,
      status: compareToTarget(today.quotationsCount, targetQuotations),
      previous: yesterday.quotationsCount,
    },
    orders: {
      actual: today.ordersClosed,
      target: targetOrders ?? null,
      status: compareToTarget(today.ordersClosed, targetOrders),
      previous: yesterday.ordersClosed,
    },
    conversionPct: {
      actual: todayConversion.actual,
      target: targetConversionPct ?? null,
      status: todayConversion.status,
      previous: yesterdayConversion.actual,
    },
    taskCompletionPct: {
      actual: taskCompletionPctToday,
      target: targetTaskCompletionPct ?? null,
      status:
        taskCompletionPctToday === null
          ? 'no_target'
          : compareToTarget(taskCompletionPctToday, targetTaskCompletionPct),
      previous: taskCompletionPctYesterday,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Pending Approvals (top-5)
// ---------------------------------------------------------------------------

export interface PendingApprovalRow {
  id: string;
  customerName: string;
  execName: string | null;
  completedAt: Date | null;
}

export async function loadPendingApprovals(captainUserId: string): Promise<{
  totalCount: number;
  topFive: PendingApprovalRow[];
}> {
  // Resolve the captain's city ids; pending-approval requests are filtered
  // by city (same model as /captain/approvals page).
  const myCities = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.captainUserId, captainUserId));
  const cityIds = myCities.map((c) => c.id);
  if (cityIds.length === 0) return { totalCount: 0, topFive: [] };

  // Find the PENDING_CAPTAIN_APPROVAL stage id once.
  const [pendingStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
    .limit(1);
  if (!pendingStage) return { totalCount: 0, topFive: [] };

  const execAlias = users; // reused — assignedExec join target

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

  // "completedAt" for the approval-queue display is the changedAt of the
  // most recent transition INTO PENDING_CAPTAIN_APPROVAL — that's when the
  // exec marked the work for approval (the wait clock starts then).
  const topFive = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      execName: execAlias.fullName,
      // Latest changedAt for transition into PENDING_CAPTAIN_APPROVAL.
      completedAt: sqlBuilder<Date | null>`(
        SELECT rsh.changed_at FROM request_status_history rsh
        WHERE rsh.request_id = ${visitRequests.id}
          AND rsh.to_status_stage_id = ${pendingStage.id}
        ORDER BY rsh.transition_order DESC
        LIMIT 1
      )`,
    })
    .from(visitRequests)
    .leftJoin(execAlias, eq(execAlias.id, visitRequests.assignedExecUserId))
    .where(
      and(
        eq(visitRequests.statusStageId, pendingStage.id),
        inArray(visitRequests.cityId, cityIds),
        isNull(visitRequests.cancelledAt),
      ),
    )
    .orderBy(desc(visitRequests.createdAt))
    .limit(5);

  // The correlated `(SELECT … LIMIT 1)` subquery returns its value as a
  // raw string from postgres-js (Drizzle's `sqlBuilder<Date | null>`
  // is a compile-time-only hint, not a runtime coercer). Normalise to
  // Date once, then sort DESC by changedAt and trim back to the public
  // shape.
  const normalized: PendingApprovalRow[] = topFive.map((row) => ({
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
  normalized.sort((a, b) => {
    const aT = a.completedAt?.getTime() ?? 0;
    const bT = b.completedAt?.getTime() ?? 0;
    return bT - aT;
  });

  return { totalCount: countRow?.cnt ?? 0, topFive: normalized };
}

// ---------------------------------------------------------------------------
// 3. Pending Collections — aging buckets (proxy via quotation.submittedAt)
// ---------------------------------------------------------------------------
//
// SCHEMA GAP (D4 in the HVA-80 bundle was already aware of this):
// `payments` has no `amount_due` / `amount_paid` / `payment_due_date`.
// "Pending collection" is derived: a request with an open quotation whose
// total order value exceeds the sum of inbound non-voided payments. Aging
// is proxied by `quotation.submittedAt` — how long the customer has had
// the quote without paying it in full.
//
// A future ticket can add a real billing-due-date column; until then this
// proxy reflects "days the customer has owed us money" which is the
// useful operational signal even if it's not the exact spec text.

export interface PendingCollectionsSummary {
  totalDueRupees: number;
  buckets: {
    zeroToSeven: number; // ₹
    eightToThirty: number;
    thirtyPlus: number;
  };
  /** Count of requests with any outstanding balance (informational badge). */
  outstandingRequestCount: number;
}

export async function loadPendingCollections(
  captainUserId: string,
): Promise<PendingCollectionsSummary> {
  // Captain's execs.
  const team = await db
    .select({ id: salesExecutives.userId })
    .from(salesExecutives)
    .where(eq(salesExecutives.captainUserId, captainUserId));
  const execIds = team.map((t) => t.id);
  if (execIds.length === 0) {
    return {
      totalDueRupees: 0,
      buckets: { zeroToSeven: 0, eightToThirty: 0, thirtyPlus: 0 },
      outstandingRequestCount: 0,
    };
  }

  // Join quotations to per-request inbound payment SUM. PostgreSQL: use a
  // correlated scalar subquery for the payments aggregate so we get
  // 1 row per quotation regardless of payment count.
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

    const ageDays = Math.floor((nowMs - r.submittedAt.getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays <= 7) {
      zeroToSeven += due;
    } else if (ageDays <= 30) {
      eightToThirty += due;
    } else {
      thirtyPlus += due;
    }
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

export type ExecDayStatus = 'no_plan' | 'in_progress' | 'closed' | 'unavailable';

export interface TeamExecStatus {
  userId: string;
  fullName: string;
  status: ExecDayStatus;
  visitsToday: number;
  collectionsTodayRupees: number;
  overdueTaskCount: number;
  /** True when the exec has at least one task with postponed_to_date < today
   *  still in `postponed` status — drives the red-flag badge in the row. */
  hasRedFlag: boolean;
  /** Today's task counts for the inline expansion. */
  todayTaskBreakdown: {
    pending: number;
    done: number;
    postponed: number;
  };
}

export async function loadTeamExecStatuses(captainUserId: string): Promise<TeamExecStatus[]> {
  const istToday = getIstDateString();

  // Captain's team. Pull isUnavailable alongside.
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

  // Day plans for today, per exec.
  const plans = await db
    .select({
      execUserId: dayPlans.execUserId,
      closedAt: dayPlans.closedAt,
    })
    .from(dayPlans)
    .where(
      and(
        inArray(dayPlans.execUserId, execIds),
        eq(dayPlans.planDate, istToday),
      ),
    );
  const planByExec = new Map(plans.map((p) => [p.execUserId, p]));

  // Task counts per exec for today.
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
        eq(tasks.taskDate, istToday),
      ),
    )
    .groupBy(tasks.execUserId, tasks.status, tasks.taskType);

  // Inbound, non-voided payments today, per exec.
  const paymentRows = await db
    .select({
      execUserId: payments.recordedByUserId,
      total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.recordedByUserId, execIds),
        eq(payments.paymentDate, istToday),
        eq(payments.direction, 'inbound'),
        isNull(payments.voidedAt),
      ),
    )
    .groupBy(payments.recordedByUserId);
  const collectionsByExec = new Map(
    paymentRows.map((p) => [p.execUserId, Number(p.total ?? 0)]),
  );

  // Overdue (postponed-to-date < today AND still postponed) per exec.
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

  // Aggregate per exec.
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
        if (
          VISIT_TASK_TYPES.includes(
            r.taskType as (typeof VISIT_TASK_TYPES)[number],
          )
        ) {
          visits += r.count;
        }
      } else if (r.status === 'postponed') postponed += r.count;
    }

    let status: ExecDayStatus;
    if (t.isUnavailable) {
      status = 'unavailable';
    } else {
      const plan = planByExec.get(t.userId);
      if (!plan) status = 'no_plan';
      else if (plan.closedAt === null) status = 'in_progress';
      else status = 'closed';
    }

    const overdueCount = overdueByExec.get(t.userId) ?? 0;

    return {
      userId: t.userId,
      fullName: t.fullName,
      status,
      visitsToday: visits,
      collectionsTodayRupees: (collectionsByExec.get(t.userId) ?? 0) / 100,
      overdueTaskCount: overdueCount,
      hasRedFlag: overdueCount > 0,
      todayTaskBreakdown: { pending, done, postponed },
    };
  });

  // Sort: most-active first (highest done count today, descending). Ties
  // break on visits, then on name to keep render stable.
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
// Pure helper exported for tests (delta sign + label)
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
