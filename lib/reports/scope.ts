import { eq, sql, type SQL } from 'drizzle-orm';

import { salesExecutives, visitRequests, tasks } from '@/db/schema';

import type { ReportScope } from './types';

// =============================================================================
// Reports — shared scope helpers
// =============================================================================
//
// Mirrors lib/metrics/scope.ts but adapted to report queries. Each
// helper returns a Drizzle SQL clause that callers AND into their
// WHERE. The captain/exec narrowing reuses the same SSOT semantic:
//   - exec scope → visit_requests.assigned_exec_user_id = X
//   - captain scope → assigned_exec IN (sales_executives where
//     captain_user_id = X)
//   - global → no filter
//
// Filters argument layers on top of scope (city / exec narrowing
// within a captain scope, etc.).
// =============================================================================

/** Build a `visit_requests`-anchored scope clause. */
export function vrScope(scope: ReportScope): SQL | undefined {
  if (scope.kind === 'exec') {
    return eq(visitRequests.assignedExecUserId, scope.execUserId);
  }
  if (scope.kind === 'captain') {
    return sql`${visitRequests.assignedExecUserId} IN (
      SELECT ${salesExecutives.userId}
      FROM ${salesExecutives}
      WHERE ${salesExecutives.captainUserId} = ${scope.captainUserId}
    )`;
  }
  return undefined;
}

/** Build a `tasks`-anchored scope clause. */
export function tasksScope(scope: ReportScope): SQL | undefined {
  if (scope.kind === 'exec') {
    return eq(tasks.execUserId, scope.execUserId);
  }
  if (scope.kind === 'captain') {
    return sql`${tasks.execUserId} IN (
      SELECT ${salesExecutives.userId}
      FROM ${salesExecutives}
      WHERE ${salesExecutives.captainUserId} = ${scope.captainUserId}
    )`;
  }
  return undefined;
}

/** Optional dimension narrow: filter to a single exec user. */
export function execFilter(execUserId: string | undefined): SQL | undefined {
  if (!execUserId) return undefined;
  return eq(visitRequests.assignedExecUserId, execUserId);
}

/** Optional dimension narrow: filter to a single city. */
export function cityFilter(cityId: string | undefined): SQL | undefined {
  if (!cityId) return undefined;
  return eq(visitRequests.cityId, cityId);
}

/** Optional dimension narrow: filter to all execs under a captain. */
export function captainFilter(
  captainUserId: string | undefined,
): SQL | undefined {
  if (!captainUserId) return undefined;
  return sql`${visitRequests.assignedExecUserId} IN (
    SELECT ${salesExecutives.userId}
    FROM ${salesExecutives}
    WHERE ${salesExecutives.captainUserId} = ${captainUserId}
  )`;
}
