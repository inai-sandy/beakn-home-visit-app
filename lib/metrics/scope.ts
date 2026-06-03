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
