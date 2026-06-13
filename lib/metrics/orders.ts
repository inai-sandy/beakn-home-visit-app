import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  quotations,
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';

import { STATUS_CODES } from './constants';
import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: orders_count, orders_value
// =============================================================================
//
// An "order" = a visit_request that transitioned INTO the
// ORDER_CONFIRMED stage at some point in the window. We look at
// request_status_history.changed_at (timestamptz; IST-cast).
//
// Calc-integrity discipline (saved memory calc-integrity-non-negotiable):
//   * orders_count: COUNT(DISTINCT request_id) — a rollback +
//     re-confirm within the window would otherwise double-count.
//   * orders_value: EXISTS subquery against status history — the outer
//     SUM is over quotations (1:1 with visit_request via UNIQUE FK), so
//     it physically cannot double-count even if history has N rollback
//     rows for the same request.
//   * IST timezone wrap on changed_at so the window respects IST
//     midnight, not UTC.
// =============================================================================

export const loadOrdersCount: MetricLoader<number> = async (
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
        eq(statusStages.code, STATUS_CODES.ORDER_CONFIRMED),
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

export const loadOrdersValue: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({
      sum: sql<string | null>`COALESCE(SUM(${quotations.totalOrderValuePaise})::text, '0')`,
    })
    .from(quotations)
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .where(
      and(
        scopeFilter,
        // HVA-281: only CartPlus quotations carry a real order value.
        eq(quotations.source, 'portal'),
        sql`EXISTS (
          SELECT 1 FROM ${requestStatusHistory} rsh
          INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
          WHERE rsh.request_id = ${quotations.visitRequestId}
            AND ss.code = ${STATUS_CODES.ORDER_CONFIRMED}
            AND (rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date >= ${range.fromDate}
            AND (rsh.changed_at AT TIME ZONE 'Asia/Kolkata')::date <= ${range.toDate}
        )`,
      ),
    );

  return Number(row?.sum ?? '0');
};
