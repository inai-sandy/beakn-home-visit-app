import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { dayPlans, outcomeOptions, tasks } from '@/db/schema';
import {
  loadPerformanceForExecIds,
  type DateFilter,
  type TeamPerformance,
} from '@/lib/captain/dashboard-queries';
import { getConfig } from '@/lib/config';
import { getIstDateString, isAtOrAfterIstTime } from '@/lib/today/time';

// =============================================================================
// HVA-169: exec dashboard server-side data fetchers
// =============================================================================
//
// `/dashboard` is the exec's analytical surface (sibling of `/today`, which
// remains the operational day-plan loop). All helpers here are scoped to one
// exec — `execUserId` is the only authorisation axis.
//
// Helpers exported:
//   - loadExecDashboardSummary  → status-banner state machine (D2)
//   - loadExecPendingTasks      → pending today + rolled-over from past
//   - loadExecPostponedTasksOpen → postponed-to-today + overdue-postponed
//                                  (HVA-171: was loadExecPostponedTasksToday;
//                                  predicate broadened so the exec can see
//                                  abandoned tasks the captain already counts
//                                  toward red-flag).
//   - loadExecCompletedTasksToday → completed today (task_date=today)
//   - loadExecTodayTaskCounts   → 3-number breakdown for accordion headers
//   - loadExecPerformance       → wrapper around shared performance helper
//
// All consume the same `getConfig('day_close_target_time')` value that
// `/today` reads — banner state and the today page can never drift on
// the close-window threshold.
// =============================================================================

export type ExecDashboardBannerState =
  | { kind: 'no_plan' }
  | {
      kind: 'in_progress';
      pending: number;
      done: number;
      postponed: number;
      nextPendingTaskTitle: string | null;
    }
  | { kind: 'closeable'; closeWindowHHMM: string }
  | { kind: 'closed'; closedAt: Date; closeWindowHHMM: string };

export interface ExecDashboardSummary {
  banner: ExecDashboardBannerState;
  istDate: string;
}

/**
 * Banner state machine for the dashboard hero.
 *
 * HVA-171 note: the `in_progress` task counts here scope to TODAY'S plan
 * (`tasks.day_plan_id = today_plan.id`), NOT to the broader open-work
 * surface that TasksAccordion shows. A task postponed from a past plan to
 * a past target date does NOT show up in the banner's `postponed` count,
 * but DOES appear in the accordion (via loadExecPostponedTasksOpen). That
 * drift is intentional: the banner answers "how is today going?" while
 * the accordion answers "what work is open across dates?".
 */
export async function loadExecDashboardSummary(
  execUserId: string,
  now: Date = new Date(),
): Promise<ExecDashboardSummary> {
  const istDate = getIstDateString(now);
  const closeWindowHHMM = (await getConfig('day_close_target_time')) as string;

  const [plan] = await db
    .select({
      id: dayPlans.id,
      submittedAt: dayPlans.submittedAt,
      closedAt: dayPlans.closedAt,
    })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, execUserId), eq(dayPlans.planDate, istDate)))
    .limit(1);

  if (!plan) {
    return { banner: { kind: 'no_plan' }, istDate };
  }

  if (plan.closedAt !== null) {
    return {
      banner: { kind: 'closed', closedAt: plan.closedAt, closeWindowHHMM },
      istDate,
    };
  }

  // Plan submitted, not closed. Bucket = closeable vs in_progress.
  if (isAtOrAfterIstTime(now, closeWindowHHMM)) {
    return {
      banner: { kind: 'closeable', closeWindowHHMM },
      istDate,
    };
  }

  // in_progress — gather today's per-status breakdown + next-pending title.
  const todayTasks = await db
    .select({
      status: tasks.status,
      description: tasks.description,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(eq(tasks.dayPlanId, plan.id))
    .orderBy(asc(tasks.createdAt));

  let pending = 0;
  let done = 0;
  let postponed = 0;
  let nextPendingTaskTitle: string | null = null;
  for (const t of todayTasks) {
    if (t.status === 'pending') {
      pending += 1;
      if (nextPendingTaskTitle === null) {
        nextPendingTaskTitle = t.description;
      }
    } else if (t.status === 'completed') {
      done += 1;
    } else if (t.status === 'postponed') {
      postponed += 1;
    }
  }

  return {
    banner: {
      kind: 'in_progress',
      pending,
      done,
      postponed,
      nextPendingTaskTitle,
    },
    istDate,
  };
}

// =============================================================================
// Tasks for the accordion
// =============================================================================
//
// Pending section combines today's pending + any rolled-over from prior days.
// Rolled-over rows come first (oldest task_date first) so the most-stale
// items surface at the top of the list.

export interface ExecDashboardTaskRow {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
  outcomeOptionId: string | null;
  outcomeOptionName: string | null;
  outcomeNotes: string | null;
  postponedToDate: string | null;
  customerInformed: boolean | null;
  rolledOverAt: string | null;
  createdAt: string;
}

function mapTaskRow(t: {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
  outcomeOptionId: string | null;
  outcomeOptionName: string | null;
  outcomeNotes: string | null;
  postponedToDate: string | null;
  customerInformed: boolean | null;
  rolledOverAt: Date | null;
  createdAt: Date;
}): ExecDashboardTaskRow {
  return {
    id: t.id,
    taskType: t.taskType,
    description: t.description,
    estimatedTime: t.estimatedTime,
    status: t.status,
    taskDate: t.taskDate,
    linkRequestId: t.linkRequestId,
    linkLeadId: t.linkLeadId,
    outcomeOptionId: t.outcomeOptionId,
    outcomeOptionName: t.outcomeOptionName,
    outcomeNotes: t.outcomeNotes,
    postponedToDate: t.postponedToDate,
    customerInformed: t.customerInformed,
    rolledOverAt: t.rolledOverAt ? t.rolledOverAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

// 2026-05-26 Option B: align Dashboard count to /tasks — drop the
// today+rolled-over predicate. Dashboard pending now matches
// loadExecAllPendingTasks 1:1 so a single number drives both surfaces.
// Rolled-over surfacing is preserved by the row-level rolledOverAt flag
// the UI uses to draw the "Rolled over from <date>" pill.
export async function loadExecPendingTasks(
  execUserId: string,
  // _now retained for signature compatibility; no longer used.
  _now: Date = new Date(),
): Promise<ExecDashboardTaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      taskType: tasks.taskType,
      description: tasks.description,
      estimatedTime: tasks.estimatedTime,
      status: tasks.status,
      taskDate: tasks.taskDate,
      linkRequestId: tasks.linkRequestId,
      linkLeadId: tasks.linkLeadId,
      outcomeOptionId: tasks.outcomeOptionId,
      outcomeOptionName: outcomeOptions.name,
      outcomeNotes: tasks.outcomeNotes,
      postponedToDate: tasks.postponedToDate,
      customerInformed: tasks.customerInformed,
      rolledOverAt: tasks.rolledOverAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .where(
      and(
        eq(tasks.execUserId, execUserId),
        eq(tasks.status, 'pending'),
      ),
    )
    // Rolled-over rows first (NULLS LAST inverts that), then oldest task_date.
    .orderBy(sql`${tasks.rolledOverAt} IS NULL`, asc(tasks.taskDate), asc(tasks.createdAt));

  return rows.map(mapTaskRow);
}

/**
 * HVA-171: postponed tasks that are still actionable from the exec's POV —
 * postponed-to-today AND overdue-postponed (postponed_to_date < today).
 * Future-postponed rows stay hidden until their target date, per D1.
 *
 * Renamed from `loadExecPostponedTasksToday` (HVA-169) — the original
 * predicate scoped by the row's enrollment `task_date`, which silently
 * dropped tasks postponed FROM the past to a past target date (e.g.
 * Sandeep's May 16 → May 19 task on May 22, walk bug). Captain side
 * (loadTeamExecStatuses overdue predicate) already had the right axis;
 * exec dashboard now matches.
 */
export async function loadExecPostponedTasksOpen(
  execUserId: string,
  now: Date = new Date(),
): Promise<ExecDashboardTaskRow[]> {
  const istDate = getIstDateString(now);
  const rows = await db
    .select({
      id: tasks.id,
      taskType: tasks.taskType,
      description: tasks.description,
      estimatedTime: tasks.estimatedTime,
      status: tasks.status,
      taskDate: tasks.taskDate,
      linkRequestId: tasks.linkRequestId,
      linkLeadId: tasks.linkLeadId,
      outcomeOptionId: tasks.outcomeOptionId,
      outcomeOptionName: outcomeOptions.name,
      outcomeNotes: tasks.outcomeNotes,
      postponedToDate: tasks.postponedToDate,
      customerInformed: tasks.customerInformed,
      rolledOverAt: tasks.rolledOverAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .where(
      and(
        eq(tasks.execUserId, execUserId),
        eq(tasks.status, 'postponed'),
        // postponed_to_date <= today (today + overdue). NULL postponed_to_date
        // is excluded — defensive guard since the postpone action validates
        // a non-null target, but better to drop ambiguous rows than render
        // them in a section that promises an actionable target date.
        sql`${tasks.postponedToDate} IS NOT NULL`,
        sql`${tasks.postponedToDate} <= ${istDate}::date`,
      ),
    )
    // Overdue rows first (oldest target date), then today's postponed.
    .orderBy(asc(tasks.postponedToDate), asc(tasks.createdAt));
  return rows.map(mapTaskRow);
}

// 2026-05-26 Option B (extended): align Dashboard with /tasks across all
// three status sections. Pending was already widened; now completed and
// postponed follow. Dashboard accordion counts and /tasks accordion
// counts now derive from identical predicates, eliminating the drift
// users were noticing (e.g. "the count of completed tasks shows wrong").
// The name keeps the historical "Today" suffix for callsite stability;
// callers don't need to rename. Newest completions surface first.
export async function loadExecCompletedTasksToday(
  execUserId: string,
  _now: Date = new Date(),
): Promise<ExecDashboardTaskRow[]> {
  void _now;
  const rows = await db
    .select({
      id: tasks.id,
      taskType: tasks.taskType,
      description: tasks.description,
      estimatedTime: tasks.estimatedTime,
      status: tasks.status,
      taskDate: tasks.taskDate,
      linkRequestId: tasks.linkRequestId,
      linkLeadId: tasks.linkLeadId,
      outcomeOptionId: tasks.outcomeOptionId,
      outcomeOptionName: outcomeOptions.name,
      outcomeNotes: tasks.outcomeNotes,
      postponedToDate: tasks.postponedToDate,
      customerInformed: tasks.customerInformed,
      rolledOverAt: tasks.rolledOverAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .where(
      and(
        eq(tasks.execUserId, execUserId),
        eq(tasks.status, 'completed'),
      ),
    )
    .orderBy(desc(tasks.completedAt), asc(tasks.createdAt));
  return rows.map(mapTaskRow);
}

export interface ExecTodayTaskCounts {
  pending: number;
  postponed: number;
  completed: number;
}

export async function loadExecTodayTaskCounts(
  execUserId: string,
  now: Date = new Date(),
): Promise<ExecTodayTaskCounts> {
  const istDate = getIstDateString(now);
  // HVA-171: each bucket has its own predicate axis, so we issue three
  // independent COUNTs instead of forcing a single GROUP BY:
  //   - pending:   task_date=today  OR  rolled_over_at IS NOT NULL
  //   - postponed: status='postponed' AND postponed_to_date <= today
  //                (today + overdue; matches loadExecPostponedTasksOpen)
  //   - completed: status='completed' AND task_date = today
  // Forcing one GROUP BY would have to OR these axes together and lose
  // bucket-level selectivity; cheaper to just run three covered queries.
  const [todayPendingRow, rolledPendingRow, postponedRow, completedRow] =
    await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.execUserId, execUserId),
            eq(tasks.status, 'pending'),
            eq(tasks.taskDate, istDate),
          ),
        ),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.execUserId, execUserId),
            eq(tasks.status, 'pending'),
            sql`${tasks.rolledOverAt} IS NOT NULL`,
            // Defensive: don't double-count if a row has both axes set.
            sql`${tasks.taskDate} < ${istDate}::date`,
          ),
        ),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.execUserId, execUserId),
            eq(tasks.status, 'postponed'),
            sql`${tasks.postponedToDate} IS NOT NULL`,
            sql`${tasks.postponedToDate} <= ${istDate}::date`,
          ),
        ),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.execUserId, execUserId),
            eq(tasks.status, 'completed'),
            eq(tasks.taskDate, istDate),
          ),
        ),
    ]);

  return {
    pending: (todayPendingRow[0]?.count ?? 0) + (rolledPendingRow[0]?.count ?? 0),
    postponed: postponedRow[0]?.count ?? 0,
    completed: completedRow[0]?.count ?? 0,
  };
}

// =============================================================================
// Performance — single-exec self-view
// =============================================================================
//
// Wraps the shared loadPerformanceForExecIds helper with the exec's own id
// as the only "team member". Returns the same TeamPerformance shape so the
// PerformanceCard component renders verbatim.

export async function loadExecPerformance(
  execUserId: string,
  filter: DateFilter,
): Promise<TeamPerformance> {
  return loadPerformanceForExecIds([execUserId], filter);
}

// =============================================================================
// Re-exports for downstream consumers — keeps the dashboard page's import
// list shorter without leaking lib/captain into every exec route file.
// =============================================================================

export type { DateFilter, TeamPerformance };
// Re-export drizzle helpers that internal callers (tests) need to read but
// shouldn't have to import via drizzle-orm directly.
export const _drizzleExprs = { asc, desc, eq, and, gte, lt, inArray, isNull, or };
