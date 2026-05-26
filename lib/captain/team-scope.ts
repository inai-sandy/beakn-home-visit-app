import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';

import { visitRequests } from '@/db/schema';

// =============================================================================
// 2026-05-26: captain team-scope visibility helper
// =============================================================================
//
// Project lock (CLAUDE.md): "Captain visibility is TEAM-scoped, not
// city-scoped. Joins on sales_executives.captain_user_id." The previous
// implementation filtered by `cities.captain_user_id`, which let captain
// B see and approve work owned by captain A's exec whenever that exec
// happened to work in a city B also owns.
//
// `buildCaptainRequestVisibilityWhere` returns the WHERE clause for
// "requests visible to this captain":
//
//   1. assigned_captain_user_id = me                — captain accepted
//      the request (exec assignment may or may not be set)
//
//   2. cancellation/unassigned fallback — when no captain has accepted
//      yet but the request is in one of the captain's cities, surface
//      it so the captain can claim + route it. This is OPTIONAL; pass
//      `captainCityIds` to enable.
//
// Use cases:
//   - /captain/approvals  — captain who accepted the request approves it
//     (pass no cityIds so only own-captain rows surface)
//   - /captain/requests   — full list, includes pending-in-my-cities so
//     newly submitted requests are still discoverable
//
// The unassigned queue (/captain/requests/unassigned) intentionally
// stays city-scoped because at SUBMITTED stage `assigned_captain_user_id`
// is NULL — captain ownership is still inherited from city default
// routing for that flow.
// =============================================================================

export function buildCaptainRequestVisibilityWhere(
  captainUserId: string,
  options?: { captainCityIds?: string[] },
): SQL {
  const captainAccepted = eq(visitRequests.assignedCaptainUserId, captainUserId);

  const cityIds = options?.captainCityIds ?? [];
  if (cityIds.length === 0) {
    return captainAccepted;
  }

  const unaccepted = and(
    isNull(visitRequests.assignedCaptainUserId),
    inArray(visitRequests.cityId, cityIds),
  );

  return or(captainAccepted, unaccepted)!;
}
