import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-201 follow-up — exec activity streak (computed on the fly)
// =============================================================================
//
// "Streak" = consecutive IST days, going backward from yesterday, where
// the exec had at least one VISIT_COMPLETED or ORDER_CONFIRMED
// transition on a request assigned to them. Today is excluded (still
// in progress) so the streak doesn't flicker through the day.
//
// Computed without a snapshot table or a cron — single GROUP BY query
// over the last 60 IST days, then a tiny JS loop per exec to count
// consecutive days backward. 60 days is enough lookback for any
// realistic streak; if anyone hits 60+ we cap and display "60+".
//
// Attribution follows the project-wide rule: streak counts days the
// exec was the ASSIGNED owner at the time of the transition (not the
// captain who clicked).
// =============================================================================

const STREAK_LOOKBACK_DAYS = 60;
export const MAX_STREAK_DAYS = STREAK_LOOKBACK_DAYS;

function shiftDateString(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Returns a Map<execUserId, streakDays>. Missing keys = no activity
 * yesterday → streak = 0. The caller decides whether to render a
 * "0-day" pill or hide it entirely.
 */
export async function loadStreaksForExecs(
  execIds: string[],
  /** Optional IST today override for tests. Defaults to the live
   *  IST date. */
  istToday?: string,
): Promise<Map<string, number>> {
  if (execIds.length === 0) return new Map();

  const today = istToday ?? getIstDateString();
  const oldestDay = shiftDateString(today, -STREAK_LOOKBACK_DAYS);
  const dayCol = sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`;

  // One row per (exec, day) where the exec had at least one qualifying
  // transition. GROUP BY keeps the result set small (~60 days × N execs).
  const rows = await db
    .select({
      execId: visitRequests.assignedExecUserId,
      day: sql<string>`${dayCol}::text`,
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
        inArray(visitRequests.assignedExecUserId, execIds),
        inArray(statusStages.code, ['VISIT_COMPLETED', 'ORDER_CONFIRMED']),
        gte(dayCol, oldestDay),
        lt(dayCol, today),
      ),
    )
    .groupBy(visitRequests.assignedExecUserId, dayCol);

  // Build a per-exec Set of active days for O(1) lookup.
  const activeDaysByExec = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.execId) continue;
    const set = activeDaysByExec.get(r.execId) ?? new Set<string>();
    set.add(r.day);
    activeDaysByExec.set(r.execId, set);
  }

  const streaks = new Map<string, number>();
  for (const execId of execIds) {
    const active = activeDaysByExec.get(execId);
    if (!active || active.size === 0) {
      streaks.set(execId, 0);
      continue;
    }
    let count = 0;
    // Walk backward from yesterday until we find a missing day.
    for (let offset = 1; offset <= STREAK_LOOKBACK_DAYS; offset += 1) {
      const day = shiftDateString(today, -offset);
      if (active.has(day)) count += 1;
      else break;
    }
    streaks.set(execId, count);
  }
  return streaks;
}

export interface ExecStreakSummary {
  /** Consecutive active IST days ending yesterday. 0 = no activity yesterday. */
  days: number;
  /** Most recent IST date (within the 60-day lookback window) where the
   *  exec had at least one qualifying transition. Null if no qualifying
   *  activity in the window — exec is genuinely new or fully inactive. */
  lastActiveDay: string | null;
}

/**
 * Single-exec helper for the exec /dashboard. Returns the active-day
 * count PLUS the most-recent active day, so the dashboard can show a
 * "0 days — last active May 19" fallback when the streak is dead but
 * the exec did work somewhere in the last 60 days.
 */
export async function loadStreakForExec(
  execUserId: string,
  istToday?: string,
): Promise<ExecStreakSummary> {
  const today = istToday ?? getIstDateString();
  const oldestDay = shiftDateString(today, -STREAK_LOOKBACK_DAYS);
  const dayCol = sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`;

  const rows = await db
    .select({
      day: sql<string>`${dayCol}::text`,
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
        eq(visitRequests.assignedExecUserId, execUserId),
        inArray(statusStages.code, ['VISIT_COMPLETED', 'ORDER_CONFIRMED']),
        gte(dayCol, oldestDay),
        lt(dayCol, today),
      ),
    )
    .groupBy(dayCol);

  if (rows.length === 0) {
    return { days: 0, lastActiveDay: null };
  }

  const activeDays = new Set(rows.map((r) => r.day));
  const sortedDesc = Array.from(activeDays).sort((a, b) =>
    b.localeCompare(a),
  );
  const lastActiveDay = sortedDesc[0];

  let count = 0;
  for (let offset = 1; offset <= STREAK_LOOKBACK_DAYS; offset += 1) {
    const day = shiftDateString(today, -offset);
    if (activeDays.has(day)) count += 1;
    else break;
  }
  return { days: count, lastActiveDay };
}
