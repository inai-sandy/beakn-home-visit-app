import { eq, sql, type SQL } from 'drizzle-orm';

import { salesExecutives, tasks, visitRequests } from '@/db/schema';

import type { MetricScope } from './types';

// =============================================================================
// Metric SSOT — scope → SQL filter helpers
// =============================================================================
//
// Every loader in lib/metrics/* runs against ONE of two row anchors:
//
//   • `visit_requests`-anchored — money, order, request-status, quotation
//     metrics. Filter via `visit_requests.assigned_exec_user_id` (for
//     exec/captain scope) or `visit_requests.city_id` (for city scope).
//
//   • `tasks`-anchored — visits, productive minutes. Filter via
//     `tasks.exec_user_id` resolved to a captain or city via
//     `sales_executives`.
//
// These helpers return a Drizzle `SQL` expression (or undefined when the
// scope is global). Callers AND it into their WHERE clauses.
//
// Behaviour matrix:
//
//   scope                      visitRequests filter
//   { execUserId }             assigned_exec_user_id = execUserId
//   { captainUserId }          assigned_exec_user_id IN (
//                                SELECT user_id FROM sales_executives
//                                WHERE captain_user_id = captainUserId
//                              )
//   { cityId }                 city_id = cityId
//   {} (global)                no filter
//
//   scope                      tasks filter
//   { execUserId }             exec_user_id = execUserId
//   { captainUserId }          exec_user_id IN (SELECT user_id FROM
//                                sales_executives WHERE captain_user_id = X)
//   { cityId }                 exec_user_id IN (SELECT user_id FROM
//                                sales_executives WHERE city_id = X)
//   {} (global)                no filter
//
// PRECEDENCE — if a caller mistakenly sets multiple scope fields, the
// helpers pick the MOST SPECIFIC: execUserId > cityId > captainUserId.
// (cityId is more specific than captainUserId because a captain may own
// multiple cities; cityId narrows further.) The types should be a
// discriminated union; keeping them optional for now so legacy callers
// passing `{}` aren't blocked, but the precedence keeps results
// deterministic if a future caller passes two.
// =============================================================================

/** Build a WHERE clause filter that constrains
 *  `visit_requests.assigned_exec_user_id` / `visit_requests.city_id`
 *  per the scope. Returns undefined for global scope. */
export function visitRequestsScopeFilter(
  scope: MetricScope,
): SQL | undefined {
  if (scope.execUserId) {
    return eq(visitRequests.assignedExecUserId, scope.execUserId);
  }
  if (scope.cityId) {
    return eq(visitRequests.cityId, scope.cityId);
  }
  if (scope.captainUserId) {
    return sql`${visitRequests.assignedExecUserId} IN (
      SELECT ${salesExecutives.userId}
      FROM ${salesExecutives}
      WHERE ${salesExecutives.captainUserId} = ${scope.captainUserId}
    )`;
  }
  return undefined;
}

/** Same shape as `visitRequestsScopeFilter` but anchored on
 *  `tasks.exec_user_id`. */
export function tasksScopeFilter(scope: MetricScope): SQL | undefined {
  if (scope.execUserId) {
    return eq(tasks.execUserId, scope.execUserId);
  }
  if (scope.cityId) {
    return sql`${tasks.execUserId} IN (
      SELECT ${salesExecutives.userId}
      FROM ${salesExecutives}
      WHERE ${salesExecutives.cityId} = ${scope.cityId}
    )`;
  }
  if (scope.captainUserId) {
    return sql`${tasks.execUserId} IN (
      SELECT ${salesExecutives.userId}
      FROM ${salesExecutives}
      WHERE ${salesExecutives.captainUserId} = ${scope.captainUserId}
    )`;
  }
  return undefined;
}

/** True when the scope targets the global view. */
export function isGlobalScope(scope: MetricScope): boolean {
  return !scope.execUserId && !scope.captainUserId && !scope.cityId;
}

/** Short human label of the scope — useful for log lines + telemetry. */
export function scopeLabel(scope: MetricScope): string {
  if (scope.execUserId) return `exec:${scope.execUserId}`;
  if (scope.cityId) return `city:${scope.cityId}`;
  if (scope.captainUserId) return `captain:${scope.captainUserId}`;
  return 'global';
}

// =============================================================================
// HVA-334: cancelled requests are not booked business
// =============================================================================
//
// Sandeep, 2026-08-06, asked whether a booked-then-cancelled order should
// still count as booked revenue: "No."
//
// Until now the dashboard disagreed with itself about that. The MONEY tiles
// said so in their own tooltips — "across all NON-CANCELLED requests",
// "total face value of every quotation on a NON-CANCELLED request" — and
// `outstanding.ts` filtered accordingly. But `orders.ts`, `revenue.ts` and
// `conversion.ts` carried no cancellation filter at all, so one screen
// answered the same question two ways. Production had Ankit's order counting
// as ₹8,354 of Booked revenue on 2026-07-09, confirmed 17:46 IST and
// cancelled 17:47 IST — seventy-nine seconds of business.
//
// CONSEQUENCE, deliberate and worth knowing: this reads the CURRENT
// cancellation state, not the state at the end of the window. An order
// booked in June and cancelled in August disappears from June's Booked
// figure retroactively. That is the point — "was it really booked?" is a
// question about now, not about what we believed in June — but it does mean
// a historical number can change after the fact, so a screenshot from last
// month may not reproduce.
// =============================================================================

/**
 * AND this into any metric that answers "how much business did we win".
 *
 * Not applied to intake metrics (`requests.ts` counts submissions, including
 * ones later cancelled — that is volume, not pipeline) nor to as-of-now
 * snapshots that already filter it themselves.
 */
export function notCancelledFilter(): SQL {
  return sql`${visitRequests.cancelledAt} IS NULL`;
}
