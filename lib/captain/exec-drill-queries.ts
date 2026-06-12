import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  dayPlans,
  leads,
  outcomeOptions,
  payments,
  quotations,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';
import {
  offsetIstDate,
  resolveDateFilter,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import {
  loadDayCloseMetrics,
  loadFinancialMetricsForDate,
  type DayCloseMetrics,
} from '@/lib/today/metrics';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-167: queries powering the captain drill-down at /captain/team/[execId]
// =============================================================================
//
// Helpers exported here:
//   - canCaptainViewExec(captainUserId, execUserId, isAdmin) — auth gate
//   - loadExecDayPlan(execUserId, dateFilter) — task list per day(s)
//   - loadExecDayClose(execUserId, dateFilter) — close-day metrics single
//     OR aggregated across the range
//   - loadExecWeeklyReport(execUserId) — last 7 days vs prev 7 (constant)
//   - loadExecLeadsBreakdown(execUserId) — 4 numbers: type × converted
//
// All assume the page-level auth gate has already validated captain ↔ exec.
// =============================================================================

export async function canCaptainViewExec(
  captainUserId: string,
  execUserId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) {
    // super_admin can drill into any active exec.
    const [row] = await db
      .select({ userId: salesExecutives.userId })
      .from(salesExecutives)
      .where(eq(salesExecutives.userId, execUserId))
      .limit(1);
    return Boolean(row);
  }
  const [row] = await db
    .select({ captainUserId: salesExecutives.captainUserId })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, execUserId))
    .limit(1);
  if (!row) return false;
  return row.captainUserId === captainUserId;
}

// -----------------------------------------------------------------------------
// Day Plan
// -----------------------------------------------------------------------------

export interface ExecDayPlanTask {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  status: string;
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
  outcomeOptionId: string | null;
  outcomeOptionName: string | null;
  outcomeNotes: string | null;
  postponedToDate: string | null;
  customerInformed: boolean | null;
  createdAt: string;
}

export interface ExecDayPlanDay {
  planDate: string;
  planId: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  tasks: ExecDayPlanTask[];
}

export interface ExecDayPlanData {
  mode: 'single' | 'range';
  days: ExecDayPlanDay[];
  /** Total task count across all days in the result set. */
  taskTotal: number;
  /** Total done across all days. */
  doneTotal: number;
}

export async function loadExecDayPlan(
  execUserId: string,
  dateFilter: DateFilter,
): Promise<ExecDayPlanData> {
  const resolved = resolveDateFilter(dateFilter);
  const { from, to } = resolved.target;
  const mode = dateFilter.mode;

  const plans = await db
    .select({
      id: dayPlans.id,
      planDate: dayPlans.planDate,
      submittedAt: dayPlans.submittedAt,
      closedAt: dayPlans.closedAt,
    })
    .from(dayPlans)
    .where(
      and(
        eq(dayPlans.execUserId, execUserId),
        gte(dayPlans.planDate, from),
        lte(dayPlans.planDate, to),
      ),
    )
    .orderBy(desc(dayPlans.planDate));

  const planIds = plans.map((p) => p.id);
  const taskRows =
    planIds.length === 0
      ? []
      : await db
          .select({
            id: tasks.id,
            taskType: tasks.taskType,
            description: tasks.description,
            estimatedTime: tasks.estimatedTime,
            status: tasks.status,
            taskDate: tasks.taskDate,
            linkRequestId: tasks.linkRequestId,
            linkLeadId: tasks.linkLeadId,
            outcomeOptionId: tasks.outcomeOptionId,
            outcomeOptionName: outcomeOptions.name,
            outcomeNotes: tasks.outcomeNotes,
            postponedToDate: tasks.postponedToDate,
            customerInformed: tasks.customerInformed,
            createdAt: tasks.createdAt,
            dayPlanId: tasks.dayPlanId,
          })
          .from(tasks)
          .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
          .where(
            and(
              eq(tasks.execUserId, execUserId),
              gte(tasks.taskDate, from),
              lte(tasks.taskDate, to),
            ),
          )
          .orderBy(asc(tasks.createdAt));

  // Group tasks by dayPlanId. Tasks without a dayPlanId (legacy or
  // orphaned) bucket by taskDate's matching plan if any; otherwise
  // they're filtered out (defensive — would be unusual).
  const planByDate = new Map(plans.map((p) => [p.planDate, p]));
  const tasksByPlanId = new Map<string, ExecDayPlanTask[]>();
  for (const t of taskRows) {
    const key = t.dayPlanId ?? planByDate.get(t.taskDate)?.id ?? null;
    if (!key) continue;
    if (!tasksByPlanId.has(key)) tasksByPlanId.set(key, []);
    tasksByPlanId.get(key)!.push({
      id: t.id,
      taskType: t.taskType,
      description: t.description,
      estimatedTime: t.estimatedTime,
      status: t.status,
      taskDate: t.taskDate,
      linkRequestId: t.linkRequestId,
      linkLeadId: t.linkLeadId,
      outcomeOptionId: t.outcomeOptionId,
      outcomeOptionName: t.outcomeOptionName,
      outcomeNotes: t.outcomeNotes,
      postponedToDate: t.postponedToDate,
      customerInformed: t.customerInformed,
      createdAt: t.createdAt.toISOString(),
    });
  }

  // For range mode we still want a row per *day in range* even if no
  // plan was submitted that day, so the UI can show "no plan submitted"
  // markers. Single mode just renders the one date.
  const days: ExecDayPlanDay[] = [];
  if (mode === 'single') {
    const plan = planByDate.get(from);
    days.push({
      planDate: from,
      planId: plan?.id ?? null,
      submittedAt: plan?.submittedAt.toISOString() ?? null,
      closedAt: plan?.closedAt ? plan.closedAt.toISOString() : null,
      tasks: plan ? (tasksByPlanId.get(plan.id) ?? []) : [],
    });
  } else {
    // Walk every IST date in [from, to] so absent plans render
    // "no plan" placeholders. Capped at 31 days (calendar picker max
    // is today-30 → today, so 31 days is the upper bound here).
    let cursor = to;
    const out: ExecDayPlanDay[] = [];
    while (cursor >= from) {
      const plan = planByDate.get(cursor);
      out.push({
        planDate: cursor,
        planId: plan?.id ?? null,
        submittedAt: plan?.submittedAt.toISOString() ?? null,
        closedAt: plan?.closedAt ? plan.closedAt.toISOString() : null,
        tasks: plan ? (tasksByPlanId.get(plan.id) ?? []) : [],
      });
      cursor = offsetIstDate(cursor, -1);
    }
    days.push(...out);
  }

  const taskTotal = days.reduce((acc, d) => acc + d.tasks.length, 0);
  const doneTotal = days.reduce(
    (acc, d) => acc + d.tasks.filter((t) => t.status === 'completed').length,
    0,
  );

  return { mode, days, taskTotal, doneTotal };
}

// -----------------------------------------------------------------------------
// Day Close (single date) OR Aggregated (range)
// -----------------------------------------------------------------------------

export interface ExecDayCloseData {
  mode: 'single' | 'range';
  /** When no plan exists for the requested single date. Range mode never null. */
  metrics: DayCloseMetrics | null;
  /** Range mode: how many days in the window had a submitted plan. */
  daysWithPlan: number;
  /** Range mode: how many days total were in the window. */
  daysInWindow: number;
}

const EMPTY_TARGET_CELL = { actual: 0, target: null, status: 'no_target' as const };
const EMPTY_METRICS: DayCloseMetrics = {
  taskCounts: {
    done: 0,
    postponed: 0,
    pending: 0,
    totalAtSubmission: 0,
    addedDuringDay: 0,
    fastCompletionCount: 0,
  },
  variancePct: null,
  estimatedTotalMinutes: 0,
  actualTotalMinutes: 0,
  amountCollectedPaise: 0,
  inboundPaymentCount: 0,
  quotationsCount: 0,
  visitedRequests: 0,
  targets: {
    revenue: { ...EMPTY_TARGET_CELL },
    visits: { ...EMPTY_TARGET_CELL },
    quotations: { ...EMPTY_TARGET_CELL },
    orders: { ...EMPTY_TARGET_CELL },
    conversionPct: { ...EMPTY_TARGET_CELL },
    taskCompletionPct: { ...EMPTY_TARGET_CELL },
  },
};

function aggregateMetrics(parts: DayCloseMetrics[]): DayCloseMetrics {
  if (parts.length === 0) return EMPTY_METRICS;

  const merged: DayCloseMetrics = {
    taskCounts: {
      done: 0,
      postponed: 0,
      pending: 0,
      totalAtSubmission: 0,
      addedDuringDay: 0,
      fastCompletionCount: 0,
    },
    variancePct: null,
    estimatedTotalMinutes: 0,
    actualTotalMinutes: 0,
    amountCollectedPaise: 0,
    inboundPaymentCount: 0,
    quotationsCount: 0,
    visitedRequests: 0,
    targets: {
      revenue: { actual: 0, target: null, status: 'no_target' },
      visits: { actual: 0, target: null, status: 'no_target' },
      quotations: { actual: 0, target: null, status: 'no_target' },
      orders: { actual: 0, target: null, status: 'no_target' },
      conversionPct: { actual: null, target: null, status: 'no_target' },
      taskCompletionPct: { actual: null, target: null, status: 'no_target' },
    },
  };

  for (const p of parts) {
    merged.taskCounts.done += p.taskCounts.done;
    merged.taskCounts.postponed += p.taskCounts.postponed;
    merged.taskCounts.pending += p.taskCounts.pending;
    merged.taskCounts.totalAtSubmission += p.taskCounts.totalAtSubmission;
    merged.taskCounts.addedDuringDay += p.taskCounts.addedDuringDay;
    merged.taskCounts.fastCompletionCount += p.taskCounts.fastCompletionCount;
    merged.estimatedTotalMinutes += p.estimatedTotalMinutes;
    merged.actualTotalMinutes += p.actualTotalMinutes;
    merged.amountCollectedPaise += p.amountCollectedPaise;
    merged.inboundPaymentCount += p.inboundPaymentCount;
    merged.quotationsCount += p.quotationsCount;
    merged.visitedRequests += p.visitedRequests;
    for (const k of ['revenue', 'visits', 'quotations', 'orders'] as const) {
      const left = merged.targets[k];
      const right = p.targets[k];
      const a = left.actual ?? 0;
      const b = right.actual ?? 0;
      merged.targets[k] = {
        actual: a + b,
        target: null,
        status: 'no_target',
      };
    }
  }

  // Percent metrics: recompute against accumulated counts so we don't
  // average percentages across days (statistically wrong).
  const totalTasks =
    merged.taskCounts.done +
    merged.taskCounts.postponed +
    merged.taskCounts.pending;
  if (totalTasks > 0) {
    merged.targets.taskCompletionPct = {
      actual: Math.round((merged.taskCounts.done / totalTasks) * 1000) / 10,
      target: null,
      status: 'no_target',
    };
  }
  // Conversion pct = orders / visits; null when visits = 0.
  // HVA-276: conversion = orders ÷ visited REQUESTS (funnel), not visit
  // tasks. Both sides are per-day DISTINCT counts summed across the
  // window — same day-wise semantics the orders tile already had.
  const orders = merged.targets.orders.actual ?? 0;
  if (merged.visitedRequests > 0) {
    merged.targets.conversionPct = {
      actual: Math.round((orders / merged.visitedRequests) * 1000) / 10,
      target: null,
      status: 'no_target',
    };
  }
  // HVA-63: variance across the window = done / totalAtSubmission.
  if (merged.taskCounts.totalAtSubmission > 0) {
    merged.variancePct = Math.round(
      (merged.taskCounts.done / merged.taskCounts.totalAtSubmission) * 100,
    );
  }
  return merged;
}

export async function loadExecDayClose(
  execUserId: string,
  dateFilter: DateFilter,
): Promise<ExecDayCloseData> {
  const resolved = resolveDateFilter(dateFilter);
  const { from, to } = resolved.target;
  const mode = dateFilter.mode;

  const plans = await db
    .select({
      id: dayPlans.id,
      planDate: dayPlans.planDate,
      submittedAt: dayPlans.submittedAt,
    })
    .from(dayPlans)
    .where(
      and(
        eq(dayPlans.execUserId, execUserId),
        gte(dayPlans.planDate, from),
        lte(dayPlans.planDate, to),
      ),
    );

  // Days-in-window count via inclusive IST calendar arithmetic.
  let daysInWindow = 0;
  let cursor = from;
  while (cursor <= to) {
    daysInWindow += 1;
    cursor = offsetIstDate(cursor, 1);
  }

  if (mode === 'single') {
    if (plans.length === 0) {
      return { mode, metrics: null, daysWithPlan: 0, daysInWindow };
    }
    const plan = plans[0];
    const metrics = await loadDayCloseMetrics({
      execUserId,
      dayPlanId: plan.id,
      dayPlanSubmittedAt: plan.submittedAt,
      istDateStr: plan.planDate,
    });
    return { mode, metrics, daysWithPlan: 1, daysInWindow };
  }

  // 2026-05-27 PR14: range mode aggregates EVERY date in the window,
  // not just dates with plans. Days without a plan still contribute
  // financial metrics (revenue / quotations / orders / visits) via
  // `loadFinancialMetricsForDate`. Without this, today's payments on
  // a no-plan day silently dropped from the Weekly Report — see the
  // 2026-05-27 walk where Singham's ₹5,000 (paid today, no plan) was
  // invisible on Veera's Weekly Report while showing correctly on
  // the Finance dashboard.
  const planByDate = new Map(plans.map((p) => [p.planDate, p]));
  const dates: string[] = [];
  {
    let cursorD = from;
    while (cursorD <= to) {
      dates.push(cursorD);
      cursorD = offsetIstDate(cursorD, 1);
    }
  }
  const perDay = await Promise.all(
    dates.map((d) => {
      const plan = planByDate.get(d);
      return plan
        ? loadDayCloseMetrics({
            execUserId,
            dayPlanId: plan.id,
            dayPlanSubmittedAt: plan.submittedAt,
            istDateStr: plan.planDate,
          })
        : loadFinancialMetricsForDate({ execUserId, istDateStr: d });
    }),
  );
  return {
    mode,
    metrics: aggregateMetrics(perDay),
    daysWithPlan: plans.length,
    daysInWindow,
  };
}

// -----------------------------------------------------------------------------
// Weekly Report (constant: last 7 days vs previous 7)
// -----------------------------------------------------------------------------

export interface ExecWeeklyReport {
  current: DayCloseMetrics;
  previous: DayCloseMetrics;
  currentWindow: { from: string; to: string };
  previousWindow: { from: string; to: string };
}

export async function loadExecWeeklyReport(
  execUserId: string,
): Promise<ExecWeeklyReport> {
  const today = getIstDateString();
  const currentWindow = { from: offsetIstDate(today, -6), to: today };
  const previousWindow = {
    from: offsetIstDate(today, -13),
    to: offsetIstDate(today, -7),
  };

  const [current, previous] = await Promise.all([
    loadExecDayClose(execUserId, {
      mode: 'range',
      from: currentWindow.from,
      to: currentWindow.to,
    }).then((d) => d.metrics ?? EMPTY_METRICS),
    loadExecDayClose(execUserId, {
      mode: 'range',
      from: previousWindow.from,
      to: previousWindow.to,
    }).then((d) => d.metrics ?? EMPTY_METRICS),
  ]);

  return { current, previous, currentWindow, previousWindow };
}

// -----------------------------------------------------------------------------
// Leads Breakdown — 4 numbers: type × converted
// -----------------------------------------------------------------------------

export interface ExecLeadsBreakdown {
  business: { converted: number; notYetConverted: number };
  customer: { converted: number; notYetConverted: number };
}

export async function loadExecLeadsBreakdown(
  execUserId: string,
): Promise<ExecLeadsBreakdown> {
  const rows = await db
    .select({
      type: leads.type,
      converted: sql<boolean>`${leads.convertedToRequestId} IS NOT NULL`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(eq(leads.capturedByUserId, execUserId))
    .groupBy(leads.type, sql`${leads.convertedToRequestId} IS NOT NULL`);

  const out: ExecLeadsBreakdown = {
    business: { converted: 0, notYetConverted: 0 },
    customer: { converted: 0, notYetConverted: 0 },
  };
  for (const r of rows) {
    const bucket = r.type === 'Business' ? out.business : out.customer;
    if (r.converted) bucket.converted = r.count;
    else bucket.notYetConverted = r.count;
  }
  return out;
}

// =============================================================================
// HVA-83: drill-down tab helpers — Open Requests / Pending Collections / Audit
// =============================================================================

export interface ExecOpenRequestRow {
  id: string;
  customerName: string;
  customerPhone: string;
  cityName: string;
  stageCode: string;
  stageName: string;
  sequenceNumber: number;
  createdAt: Date;
  visitScheduledAt: Date | null;
}

/** Open = not cancelled AND not at terminal positive stage. */
export async function loadExecOpenRequests(
  execUserId: string,
): Promise<ExecOpenRequestRow[]> {
  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      stageCode: statusStages.code,
      stageName: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
      createdAt: visitRequests.createdAt,
      visitScheduledAt: visitRequests.visitScheduledAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(
      and(
        eq(visitRequests.assignedExecUserId, execUserId),
        isNull(visitRequests.cancelledAt),
        sql`${statusStages.code} != 'ORDER_EXECUTED_SUCCESSFULLY'`,
      ),
    )
    .orderBy(asc(statusStages.sequenceNumber), desc(visitRequests.createdAt));
  return rows;
}

export interface ExecPendingCollectionRow {
  requestId: string;
  customerName: string;
  cityName: string;
  quotedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  quotedAt: Date;
}

/** Outstanding = quotation_total − net_paid where net_paid = SUM(inbound) − SUM(outbound).
 *  Sandeep 2026-06-03: refunds (outbound) now properly subtract from "paid" so
 *  a fully-refunded request returns to its full quotation outstanding. Listed
 *  only when outstanding > 0 and at least one quotation exists. */
export async function loadExecPendingCollections(
  execUserId: string,
): Promise<ExecPendingCollectionRow[]> {
  const rows = await db
    .select({
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      quotedPaise: sql<number>`COALESCE(SUM(DISTINCT ${quotations.totalOrderValuePaise}), 0)::bigint`,
      paidPaise: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.voidedAt} IS NULL AND ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.voidedAt} IS NULL AND ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
      quotedAt: sql<Date>`MAX(${quotations.submittedAt})`,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .leftJoin(payments, eq(payments.visitRequestId, visitRequests.id))
    .where(
      and(
        eq(visitRequests.assignedExecUserId, execUserId),
        isNull(visitRequests.cancelledAt),
      ),
    )
    .groupBy(visitRequests.id, cities.name, visitRequests.customerName);

  return rows
    .map((r) => ({
      requestId: r.requestId,
      customerName: r.customerName,
      cityName: r.cityName,
      quotedPaise: Number(r.quotedPaise),
      paidPaise: Number(r.paidPaise),
      outstandingPaise: Number(r.quotedPaise) - Number(r.paidPaise),
      quotedAt: r.quotedAt,
    }))
    .filter((r) => r.outstandingPaise > 0)
    .sort((a, b) => b.outstandingPaise - a.outstandingPaise);
}

export interface ExecAuditRow {
  id: string;
  eventType: string;
  targetEntityType: string | null;
  targetEntityId: string | null;
  createdAt: Date;
  reason: string | null;
}

/** Exec-scoped audit trail. Paginated. Returns rows + a flag whether more
 *  exist beyond this page. */
export async function loadExecAuditTrail(args: {
  execUserId: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: ExecAuditRow[]; total: number }> {
  const pageSize = args.pageSize ?? 25;
  const page = Math.max(1, args.page ?? 1);
  const offset = (page - 1) * pageSize;

  const [rowsResult, totalResult] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        eventType: auditLog.eventType,
        targetEntityType: auditLog.targetEntityType,
        targetEntityId: auditLog.targetEntityId,
        createdAt: auditLog.createdAt,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .where(eq(auditLog.actorUserId, args.execUserId))
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(eq(auditLog.actorUserId, args.execUserId)),
  ]);

  return {
    rows: rowsResult,
    total: totalResult[0]?.cnt ?? 0,
  };
}
