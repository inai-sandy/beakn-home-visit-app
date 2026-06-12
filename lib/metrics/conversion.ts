import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';

import { STATUS_CODES } from './constants';
import { loadOrdersCount } from './orders';
import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: conversion_pct
// =============================================================================
//
// HVA-276: conversion_pct = (orders_count / visited_requests) * 100,
// rounded to int. Returns null when visited_requests == 0.
//
// "Visited requests" = DISTINCT requests that transitioned INTO
// VISIT_COMPLETED during the window — the same status-history shape as
// orders_count, so numerator and denominator count the SAME kind of
// thing (customer requests) over the SAME clock (IST transition date).
//
// The previous denominator was completed visit-type TASKS, which let
// conversion exceed 100% (one ticked task, two confirmed orders →
// 200%) and let sales pitches / outlet visits dilute the funnel. The
// "Visits" tile still counts tasks — it is an activity measure;
// conversion is a funnel measure. They intentionally use different
// denominators now, and the ⓘ explainers say so.
// =============================================================================

/** DISTINCT requests entering VISIT_COMPLETED in the window. Internal
 *  to the conversion formula today; exported for tests and for any
 *  future "Customers visited" surface. */
export const loadVisitedRequestsCount: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({
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
        eq(statusStages.code, STATUS_CODES.VISIT_COMPLETED),
        gte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.fromDate,
        ),
        lte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.toDate,
        ),
        scopeFilter,
      ),
    );

  return row?.cnt ?? 0;
};

export const loadConversionPct: MetricLoader<number | null> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const [orders, visited] = await Promise.all([
    loadOrdersCount(scope, range),
    loadVisitedRequestsCount(scope, range),
  ]);
  if (visited === 0) return null;
  return Math.round((orders / visited) * 100);
};
