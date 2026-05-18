import { and, eq, gt, inArray, isNull, sql as sqlBuilder } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  payments,
  quotations,
  requestStatusHistory,
  statusStages,
  tasks,
  visitRequests,
} from '@/db/schema';

import { getConfig } from '@/lib/config';

import { compareConversionPct, compareToTarget, type TargetStatus } from './targets';
import { isFastCompletion } from './time';

// =============================================================================
// HVA-64: Close the Day server-side metric queries
// =============================================================================
//
// All queries are scoped by (current exec user, today's day_plan). The
// caller resolves the day_plan id and IST date string before calling; this
// module is a leaf — no role checks, no session lookup.
//
// Layer ordering in the function:
//   1. Single-query aggregates (task counts, payment SUM, etc.)
//   2. Derived metrics + target comparisons
//
// Note on the "orders closed today" metric (D8 in the bundle):
// `request_status_history` carries one row per stage transition with
// `changed_by_user_id` + `changed_at` + `to_status_stage_id`. Counting
// DISTINCT request_id where the transition target was ORDER_CONFIRMED or
// ORDER_EXECUTED_SUCCESSFULLY catches both "order placed today" and
// "order executed today" without double-counting a single request that
// hit both stages on the same day.
// =============================================================================

const VISIT_TASK_TYPES = ['Customer home visit', 'Sales pitch', 'Outlet visit'] as const;
const ORDERS_STAGE_CODES = [
  'ORDER_CONFIRMED',
  'ORDER_EXECUTED_SUCCESSFULLY',
] as const;

export interface DayCloseMetrics {
  // Plan vs Actual
  taskCounts: {
    done: number;
    postponed: number;
    pending: number;
    totalAtSubmission: number;
    addedDuringDay: number;
    fastCompletionCount: number;
  };
  // Money
  amountCollectedPaise: number;
  inboundPaymentCount: number;
  // Submissions
  quotationsCount: number;
  // 6 target metrics
  targets: {
    revenue: TargetCell;
    visits: TargetCell;
    quotations: TargetCell;
    orders: TargetCell;
    conversionPct: TargetCell;
    taskCompletionPct: TargetCell;
  };
}

export interface TargetCell {
  /** Numeric value. `null` for conversion% when visits=0. */
  actual: number | null;
  target: number | null;
  status: TargetStatus;
}

export async function loadDayCloseMetrics(args: {
  execUserId: string;
  dayPlanId: string;
  dayPlanSubmittedAt: Date;
  istDateStr: string;
}): Promise<DayCloseMetrics> {
  const { execUserId, dayPlanId, dayPlanSubmittedAt, istDateStr } = args;

  // -------------------------------------------------------------------------
  // 1. Task rows for the day. We pull every task once and tally in JS —
  //    cheaper than 5 separate aggregate queries for a typical day's
  //    handful of rows, and lets the fast-completion flag inspect both
  //    actual_time and estimated_time without a second pass.
  // -------------------------------------------------------------------------
  const todayTasks = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      taskType: tasks.taskType,
      estimatedTime: tasks.estimatedTime,
      actualTime: tasks.actualTime,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(eq(tasks.dayPlanId, dayPlanId));

  const taskCounts = {
    done: 0,
    postponed: 0,
    pending: 0,
    totalAtSubmission: 0,
    addedDuringDay: 0,
    fastCompletionCount: 0,
  };
  let visitsCompleted = 0;
  for (const t of todayTasks) {
    if (t.status === 'completed') {
      taskCounts.done += 1;
      if (isFastCompletion(t.estimatedTime, t.actualTime)) {
        taskCounts.fastCompletionCount += 1;
      }
      if (VISIT_TASK_TYPES.includes(t.taskType as (typeof VISIT_TASK_TYPES)[number])) {
        visitsCompleted += 1;
      }
    } else if (t.status === 'postponed') {
      taskCounts.postponed += 1;
    } else if (t.status === 'pending') {
      taskCounts.pending += 1;
    }
    if (t.createdAt.getTime() > dayPlanSubmittedAt.getTime()) {
      taskCounts.addedDuringDay += 1;
    } else {
      taskCounts.totalAtSubmission += 1;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Money — SUM inbound payments recorded by this exec on this IST day.
  //    Excludes voided rows (HVA-70 void writes voided_at). Excludes
  //    outbound rows (refunds carry a negative meaning; the "amount
  //    collected" metric is gross inbound).
  // -------------------------------------------------------------------------
  const [paymentAgg] = await db
    .select({
      total: sqlBuilder<string | null>`COALESCE(SUM(${payments.amountPaise}), 0)::text`,
      cnt: sqlBuilder<number>`COUNT(*)::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.recordedByUserId, execUserId),
        eq(payments.paymentDate, istDateStr),
        eq(payments.direction, 'inbound'),
        isNull(payments.voidedAt),
      ),
    );
  const amountCollectedPaise = Number(paymentAgg?.total ?? 0);
  const inboundPaymentCount = paymentAgg?.cnt ?? 0;

  // -------------------------------------------------------------------------
  // 3. Quotations submitted today (Δ3 — using submittedAt + submittedByUserId).
  // -------------------------------------------------------------------------
  const [quotationAgg] = await db
    .select({
      cnt: sqlBuilder<number>`COUNT(*)::int`,
    })
    .from(quotations)
    .where(
      and(
        eq(quotations.submittedByUserId, execUserId),
        sqlBuilder`${quotations.submittedAt}::date = ${istDateStr}::date`,
      ),
    );
  const quotationsCount = quotationAgg?.cnt ?? 0;

  // -------------------------------------------------------------------------
  // 4. Orders closed today — distinct request_id where this exec drove a
  //    transition to ORDER_CONFIRMED or ORDER_EXECUTED_SUCCESSFULLY today.
  //    INNER JOIN status_stages so we can filter by code.
  // -------------------------------------------------------------------------
  const [ordersAgg] = await db
    .select({
      cnt: sqlBuilder<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .innerJoin(statusStages, eq(statusStages.id, requestStatusHistory.toStatusStageId))
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .where(
      and(
        eq(requestStatusHistory.changedByUserId, execUserId),
        eq(visitRequests.assignedExecUserId, execUserId),
        inArray(statusStages.code, ORDERS_STAGE_CODES as readonly string[]),
        sqlBuilder`${requestStatusHistory.changedAt}::date = ${istDateStr}::date`,
      ),
    );
  const ordersClosed = ordersAgg?.cnt ?? 0;

  // -------------------------------------------------------------------------
  // 5. Targets — pull all 6 keys once via getConfig. compareToTarget
  //    folds the gray "no target" path when the value is missing/zero.
  // -------------------------------------------------------------------------
  const [
    targetRevenue,
    targetVisits,
    targetQuotations,
    targetOrders,
    targetConversionPct,
    targetTaskCompletionPct,
  ] = await Promise.all([
    getConfig('target_daily_revenue'),
    getConfig('target_daily_visits'),
    getConfig('target_daily_quotations'),
    getConfig('target_daily_orders'),
    getConfig('target_daily_conversion_pct'),
    getConfig('target_daily_task_completion_pct'),
  ]);

  const taskTotalDecided =
    taskCounts.done + taskCounts.postponed + taskCounts.pending;
  const taskCompletionPct =
    taskTotalDecided === 0 ? null : (taskCounts.done / taskTotalDecided) * 100;

  // Revenue target is stored in ₹ (matches spec), payment amounts in paise.
  // Convert paise → ₹ for the actual-vs-target comparison.
  const revenueRupees = amountCollectedPaise / 100;

  const conversion = compareConversionPct(ordersClosed, visitsCompleted, targetConversionPct);

  const targets: DayCloseMetrics['targets'] = {
    revenue: {
      actual: revenueRupees,
      target: targetRevenue ?? null,
      status: compareToTarget(revenueRupees, targetRevenue),
    },
    visits: {
      actual: visitsCompleted,
      target: targetVisits ?? null,
      status: compareToTarget(visitsCompleted, targetVisits),
    },
    quotations: {
      actual: quotationsCount,
      target: targetQuotations ?? null,
      status: compareToTarget(quotationsCount, targetQuotations),
    },
    orders: {
      actual: ordersClosed,
      target: targetOrders ?? null,
      status: compareToTarget(ordersClosed, targetOrders),
    },
    conversionPct: {
      actual: conversion.actual,
      target: targetConversionPct ?? null,
      status: conversion.status,
    },
    taskCompletionPct: {
      actual: taskCompletionPct,
      target: targetTaskCompletionPct ?? null,
      status:
        taskCompletionPct === null
          ? 'no_target'
          : compareToTarget(taskCompletionPct, targetTaskCompletionPct),
    },
  };

  return {
    taskCounts,
    amountCollectedPaise,
    inboundPaymentCount,
    quotationsCount,
    targets,
  };
}

/**
 * Pure helper used by tests + the metric computation: derive the task
 * completion percent from the three count buckets. Returns null when
 * there is no decided/undecided task at all (all-zero state) — matches
 * the spec's "skip if denominator is zero" stance.
 */
export function computeTaskCompletionPct(args: {
  done: number;
  postponed: number;
  pending: number;
}): number | null {
  const denom = args.done + args.postponed + args.pending;
  if (denom === 0) return null;
  return (args.done / denom) * 100;
}
