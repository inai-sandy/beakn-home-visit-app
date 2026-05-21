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
  type SQL,
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
// HVA-154 + HVA-167: per-exec metrics
// =============================================================================
//
// Two callers:
//
//   - loadTeamExecMetrics(captainId, dateFilter) — HVA-154 /captain/team
//     list. Returns one entry per exec on the captain's active team.
//
//   - loadSingleExecMetrics(execUserId, dateFilter) — HVA-167 captain
//     drill-down at /captain/team/[execId]. Returns the same shape for
//     exactly one exec, scoped via an `exec_id = ?` predicate instead
//     of the team's `inArray`. Avoids loading N-1 wasted rows on every
//     drill-down render (the page's auth gate has already verified the
//     captain owns this exec — no need to re-fetch the team set).
//
// Both share `buildExecMetricsFor(...)` so the date-window math, the
// active-request predicate, and the captured-contacts predicate stay
// in lockstep. Adding a new metric is one place to change.
//
// Aggregates surfaced:
//   - activeRequestCount: visit_requests assigned to the exec, not
//     cancelled, status_code NOT IN TERMINAL_POSITIVE_STATUS_CODES.
//     Current state — date window does NOT apply.
//   - contactsCapturedInWindow: leads.captured_by_user_id = exec AND
//     leads.created_at in [from 00:00 IST, to+1 00:00 IST). Half-open
//     upper bound so the inclusive `to` day is fully covered.
//   - isUnavailable: sales_executives.is_unavailable verbatim.
// =============================================================================

export interface TeamMemberMetrics {
  userId: string;
  activeRequestCount: number;
  contactsCapturedInWindow: number;
  isUnavailable: boolean;
}

interface ExecScope {
  /** Predicate matching visit_requests.assigned_exec_user_id (single or set). */
  activeRequestsExecPredicate: SQL;
  /** Predicate matching leads.captured_by_user_id (single or set). */
  leadsCaptorPredicate: SQL;
}

function buildExecScopeForTeam(execIds: string[]): ExecScope {
  return {
    activeRequestsExecPredicate: inArray(
      visitRequests.assignedExecUserId,
      execIds,
    ),
    leadsCaptorPredicate: inArray(leads.capturedByUserId, execIds),
  };
}

function buildExecScopeForSingle(execUserId: string): ExecScope {
  return {
    activeRequestsExecPredicate: eq(
      visitRequests.assignedExecUserId,
      execUserId,
    ),
    leadsCaptorPredicate: eq(leads.capturedByUserId, execUserId),
  };
}

async function runMetricRollups(scope: ExecScope, dateFilter: DateFilter) {
  const resolved = resolveDateFilter(dateFilter);
  const { from, to } = resolved.target;
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
          scope.activeRequestsExecPredicate,
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
          scope.leadsCaptorPredicate,
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
  return { activeByExec, capturedByExec };
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
  const { activeByExec, capturedByExec } = await runMetricRollups(
    buildExecScopeForTeam(execIds),
    dateFilter,
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

/**
 * HVA-167: single-exec variant. Auth (captain owns this exec) is the
 * caller's responsibility — we do NOT re-check team membership here.
 * Returns null when the exec row is missing OR inactive (defensive;
 * matches the team-side filter of active execs only).
 */
export async function loadSingleExecMetrics(
  execUserId: string,
  dateFilter: DateFilter,
): Promise<TeamMemberMetrics | null> {
  const [row] = await db
    .select({
      userId: salesExecutives.userId,
      isUnavailable: salesExecutives.isUnavailable,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(eq(salesExecutives.userId, execUserId), eq(users.isActive, true)),
    )
    .limit(1);

  if (!row) return null;

  const { activeByExec, capturedByExec } = await runMetricRollups(
    buildExecScopeForSingle(execUserId),
    dateFilter,
  );
  return {
    userId: row.userId,
    activeRequestCount: activeByExec.get(execUserId) ?? 0,
    contactsCapturedInWindow: capturedByExec.get(execUserId) ?? 0,
    isUnavailable: row.isUnavailable,
  };
}

export { asc };
