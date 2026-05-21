import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';

import { db } from '@/db/client';
import {
  leads,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import {
  offsetIstDate,
  resolveDateFilter,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { TERMINAL_POSITIVE_STATUS_CODES } from '@/lib/captain/request-buckets';

// =============================================================================
// HVA-154: captain "My Team" per-exec metrics
// =============================================================================
//
// `loadTeamExecStatuses` already covers status / overdue / visits today /
// collections / hasRedFlag — we leave it alone and add the two missing
// aggregates plus the availability flag here:
//
//   - activeRequestCount: visit_requests where assigned to the exec,
//     not cancelled, and not in a terminal-positive status code.
//     Date window does NOT apply (D4) — "active" is current state.
//   - contactsCapturedInWindow: leads where captured_by_user_id = exec
//     AND created_at falls in the resolved DateFilter window.
//   - isUnavailable: sales_executives.is_unavailable column verbatim.
//
// Three round trips: team scope (joined to users.is_active and
// sales_executives.is_unavailable for the availability flag), active
// requests rollup, captured contacts rollup. Each rollup is a single
// GROUP BY query keyed on the exec id.
//
// Result is a Map<userId, TeamMemberMetrics> so the page can O(1)
// merge into the existing TeamExecStatus rows from
// loadTeamExecStatuses.
// =============================================================================

export interface TeamMemberMetrics {
  userId: string;
  activeRequestCount: number;
  contactsCapturedInWindow: number;
  isUnavailable: boolean;
}

export async function loadTeamExecMetrics(
  captainUserId: string,
  dateFilter: DateFilter,
): Promise<Map<string, TeamMemberMetrics>> {
  const team = await db
    .select({
      userId: salesExecutives.userId,
      isUnavailable: salesExecutives.isUnavailable,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    );

  if (team.length === 0) return new Map();

  const execIds = team.map((t) => t.userId);
  const resolved = resolveDateFilter(dateFilter);
  const { from, to } = resolved.target;

  // captured_at semantics: leads.created_at is the timestamp. The
  // window comes in as IST date strings (YYYY-MM-DD). We compare via
  // half-open interval [from 00:00 IST, to+1 00:00 IST) so the
  // inclusive `to` day is covered. Postgres `BETWEEN` on
  // timestamptz vs. date is forgiving — use explicit cast for clarity.
  const captureStart = `${from} 00:00:00+05:30`;
  const captureEndExclusive = `${offsetIstDate(to, 1)} 00:00:00+05:30`;

  const [activeRows, capturedRows] = await Promise.all([
    db
      .select({
        execUserId: visitRequests.assignedExecUserId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(visitRequests)
      .innerJoin(
        statusStages,
        eq(statusStages.id, visitRequests.statusStageId),
      )
      .where(
        and(
          inArray(visitRequests.assignedExecUserId, execIds),
          isNull(visitRequests.cancelledAt),
          notInArray(
            statusStages.code,
            TERMINAL_POSITIVE_STATUS_CODES as string[],
          ),
        ),
      )
      .groupBy(visitRequests.assignedExecUserId),
    db
      .select({
        execUserId: leads.capturedByUserId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(leads)
      .where(
        and(
          inArray(leads.capturedByUserId, execIds),
          gte(leads.createdAt, sql`${captureStart}::timestamptz`),
          lt(leads.createdAt, sql`${captureEndExclusive}::timestamptz`),
        ),
      )
      .groupBy(leads.capturedByUserId),
  ]);

  const activeByExec = new Map(
    activeRows
      .filter((r): r is { execUserId: string; count: number } =>
        r.execUserId !== null,
      )
      .map((r) => [r.execUserId, r.count]),
  );
  const capturedByExec = new Map(
    capturedRows.map((r) => [r.execUserId, r.count]),
  );

  const out = new Map<string, TeamMemberMetrics>();
  for (const t of team) {
    out.set(t.userId, {
      userId: t.userId,
      activeRequestCount: activeByExec.get(t.userId) ?? 0,
      contactsCapturedInWindow: capturedByExec.get(t.userId) ?? 0,
      isUnavailable: t.isUnavailable,
    });
  }
  return out;
}

export { asc };
