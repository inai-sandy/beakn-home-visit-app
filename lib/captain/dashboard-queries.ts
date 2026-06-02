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
    // 2026-05-27 fix: attribute payments to the request's ASSIGNED exec,
    // not to whoever physically clicked Record Payment. Walk-bug: Arjun
    // (captain) recorded ₹5,000 on Singham (Veera's request) and the
    // team's Revenue tile showed ₹0 — because Arjun isn't on his own
    // team. The visit-request join makes the attribution match reality.
    db
      .select({
        total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
      })
      .from(payments)
      .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
      .where(
        and(
          inArray(visitRequests.assignedExecUserId, execIds as string[]),
          isNull(visitRequests.cancelledAt),
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
    // 2026-05-27: attribute quotations to the request's assigned exec,
    // not whoever clicked Submit. Captain-submitted quotations on
    // behalf of an exec correctly count toward the team total now.
    db
      .select({ cnt: sqlBuilder<number>`COUNT(*)::int` })
      .from(quotations)
      .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
      .where(
        and(
          inArray(visitRequests.assignedExecUserId, execIds as string[]),
          isNull(visitRequests.cancelledAt),
          // CALC INTEGRITY 2026-06-02: timestamptz cast must respect IST
          // boundaries or after 18:30 UTC the date filter shifts and a
          // quotation submitted just after IST midnight falls into the
          // previous day's bucket. Same fix shipped on the leaderboard
          // 2026-06-01 (queries.ts:199-200).
          sqlBuilder`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date`,
          sqlBuilder`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`,
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
          // HVA-168: attribute the order to the assigned exec, not to
          // whoever fired the transition. Captain-approved orders
          // (HVA-137 flow, where changed_by_user_id = captain) were
          // previously excluded from the exec's tally.
          inArray(visitRequests.assignedExecUserId, execIds as string[]),
          inArray(statusStages.code, ORDERS_STAGE_CODES as readonly string[]),
          // CALC INTEGRITY 2026-06-02: same IST-cast fix as above; the
          // leaderboard's twin fix lives at queries.ts:232-233.
          sqlBuilder`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date`,
          sqlBuilder`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`,
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
  const execIds = await loadCaptainTeamIds(captainUserId);
  return loadPerformanceForExecIds(execIds, filter);
}

/**
 * HVA-169: shared performance computation usable for either a captain's team
 * (loadTeamPerformance) or a single exec self-view (loadExecPerformance in
 * lib/exec/dashboard-queries.ts). Same 6-metric `TeamPerformance` shape so
 * the PerformanceCard component is reusable verbatim.
 *
 * `execIds` is the set the metrics roll up over: pass the captain's full
 * team for the captain dashboard, or `[execId]` for the exec self-view.
 * Returns the zero-row shape if execIds is empty.
 */
export async function loadPerformanceForExecIds(
  execIds: readonly string[],
  filter: DateFilter,
): Promise<TeamPerformance> {
  const resolved = resolveDateFilter(filter);

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
// ALWAYS SNAPSHOT SEMANTIC (HVA-168):
//   The card is an action prompt — "what needs my attention right now"
//   — not an analytics tile. Count + top-5 always reflect requests
//   whose CURRENT `statusStageId` is PENDING_CAPTAIN_APPROVAL. Window
//   filter is intentionally ignored.
//
// Previously this had a two-branch implementation: snapshot for today,
// `request_status_history` "entered the stage in window" for past
// dates / ranges. The historical branch never re-checked current
// status, so already-approved requests reappeared whenever the
// captain selected a non-today filter. HVA-168 deletes that branch.
// The `filter` parameter is kept on the signature so call sites
// don't need to change; it's no longer used.

export interface PendingApprovalRow {
  id: string;
  customerName: string;
  execName: string | null;
  completedAt: Date | null;
}

export async function loadPendingApprovals(
  captainUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _filter: DateFilter,
): Promise<{
  totalCount: number;
  /** 2026-05-26: count of pending approvals whose most recent
   *  PENDING_CAPTAIN_APPROVAL entry happened >24h ago. Surfaces an SLA
   *  cue on the dashboard so the queue doesn't quietly bloat. */
  staleCount: number;
  topFive: PendingApprovalRow[];
}> {
  const myCities = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.captainUserId, captainUserId));
  const cityIds = myCities.map((c) => c.id);
  if (cityIds.length === 0)
    return { totalCount: 0, staleCount: 0, topFive: [] };

  const [pendingStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
    .limit(1);
  if (!pendingStage) return { totalCount: 0, staleCount: 0, topFive: [] };

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

  // 2026-05-26: stale = most recent entry-into-pending happened >24h ago.
  // Computed via the same correlated subquery used in the row loader so
  // both surfaces agree on which row counts as "the" landing timestamp.
  const [staleRow] = await db
    .select({ cnt: sqlBuilder<number>`COUNT(*)::int` })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.statusStageId, pendingStage.id),
        inArray(visitRequests.cityId, cityIds),
        isNull(visitRequests.cancelledAt),
        sqlBuilder`(
          SELECT rsh.changed_at FROM request_status_history rsh
          WHERE rsh.request_id = ${visitRequests.id}
            AND rsh.to_status_stage_id = ${pendingStage.id}
          ORDER BY rsh.transition_order DESC
          LIMIT 1
        ) < NOW() - INTERVAL '24 hours'`,
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
  // Most recent entry-into-pending first.
  normalized.sort(
    (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
  );

  return {
    totalCount: countRow?.cnt ?? 0,
    staleCount: staleRow?.cnt ?? 0,
    topFive: normalized,
  };
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
  /** 2026-05-26: count of outstanding requests whose quotation was
   *  submitted >48h ago. Drives the stale-alert banner on the dashboard. */
  staleCount: number;
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
      staleCount: 0,
    };
  }

  // Filter semantic (locked decision):
  //   single mode → "as of date X" = all quotations submitted on/before X
  //                  (D2: "quotations submitted ≤ that date")
  //   range mode → "submitted within the window" = both ends inclusive
  //                  (D3: "where quotation.submittedAt is within range")
  // CALC INTEGRITY 2026-06-02: cast in IST so quotations submitted just
  // after IST midnight don't fall into the previous day's bucket. Same
  // root cause as the leaderboard timezone fix 2026-06-01.
  const submittedConstraint =
    filter.mode === 'single'
      ? sqlBuilder`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date <= ${resolved.target.to}::date`
      : and(
          sqlBuilder`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date >= ${resolved.target.from}::date`,
          sqlBuilder`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date <= ${resolved.target.to}::date`,
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
  let staleCount = 0;

  const nowMs = Date.now();
  const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;
  for (const r of rows) {
    const total = Number(r.totalOrderValuePaise);
    const paid = Number(r.paidPaise ?? 0);
    const due = total - paid;
    if (due <= 0) continue;
    outstandingRequestCount += 1;
    totalDuePaise += due;
    const ageMs = nowMs - r.submittedAt.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    if (ageDays <= 7) zeroToSeven += due;
    else if (ageDays <= 30) eightToThirty += due;
    else thirtyPlus += due;
    // 2026-05-26: stale = quotation submitted >48h ago AND still has
    // outstanding due. Captures the "we sent a quote 2 days ago but
    // nobody's collected yet" cohort.
    if (ageMs > STALE_THRESHOLD_MS) staleCount += 1;
  }

  return {
    totalDueRupees: totalDuePaise / 100,
    buckets: {
      zeroToSeven: zeroToSeven / 100,
      eightToThirty: eightToThirty / 100,
      thirtyPlus: thirtyPlus / 100,
    },
    outstandingRequestCount,
    staleCount,
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

  // 2026-05-27: per-exec collections roll up by the request's assigned
  // exec (not the clicker). Captain or admin recording on behalf still
  // lands in the right exec's bucket.
  const paymentRows = await db
    .select({
      execUserId: visitRequests.assignedExecUserId,
      total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(
      and(
        inArray(visitRequests.assignedExecUserId, execIds),
        isNull(visitRequests.cancelledAt),
        gte(payments.paymentDate, from),
        lte(payments.paymentDate, to),
        eq(payments.direction, 'inbound'),
        isNull(payments.voidedAt),
      ),
    )
    .groupBy(visitRequests.assignedExecUserId);
  const collectionsByExec = new Map(
    paymentRows
      .filter((p): p is { execUserId: string; total: string | null } => p.execUserId !== null)
      .map((p) => [p.execUserId, Number(p.total ?? 0)]),
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

  // HVA-169: aged rolled-over predicate. A task that has been carrying
  // `rolled_over_at` for more than 3 days (= 72 wall-clock hours) raises
  // the red flag on the captain dashboard, even if the exec has zero
  // overdue-postponed tasks.
  //
  // Threshold semantics: `NOW() - INTERVAL '3 days'` is wall-clock UTC
  // and timezone-stable. A task rolled over at 21:31 IST clears the flag
  // exactly 72h later at 21:31 IST — symmetric, no DST or IST-midnight
  // edge cases. Don't "fix" this to IST midnight; the symmetry is
  // intentional and matches how `created_at`-based aging buckets work
  // elsewhere.
  const agedRolledOverRows = await db
    .select({ execUserId: tasks.execUserId })
    .from(tasks)
    .where(
      and(
        inArray(tasks.execUserId, execIds),
        eq(tasks.status, 'pending'),
        sqlBuilder`${tasks.rolledOverAt} IS NOT NULL`,
        sqlBuilder`${tasks.rolledOverAt} < NOW() - INTERVAL '3 days'`,
      ),
    )
    .groupBy(tasks.execUserId);
  const agedRolledOverExecs = new Set(agedRolledOverRows.map((r) => r.execUserId));

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
    const hasAgedRolledOver = agedRolledOverExecs.has(t.userId);
    return {
      userId: t.userId,
      fullName: t.fullName,
      status,
      rangeClosedSummary,
      visitsToday: visits,
      collectionsTodayRupees: (collectionsByExec.get(t.userId) ?? 0) / 100,
      overdueTaskCount: overdueCount,
      // HVA-169: either signal raises the flag. overdueTaskCount stays
      // the literal count (consumers can split-display if they want);
      // hasRedFlag is the OR.
      hasRedFlag: overdueCount > 0 || hasAgedRolledOver,
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
