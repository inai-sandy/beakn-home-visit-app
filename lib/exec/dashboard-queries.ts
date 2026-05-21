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
//   - loadExecPostponedTasksToday / loadExecCompletedTasksToday
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

export async function loadExecPendingTasks(
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
        eq(tasks.status, 'pending'),
        // task_date = today  OR  rolled_over_at is set.
        or(eq(tasks.taskDate, istDate), sql`${tasks.rolledOverAt} IS NOT NULL`),
      ),
    )
    // Rolled-over rows first (NULLS LAST inverts that), then oldest task_date.
    .orderBy(sql`${tasks.rolledOverAt} IS NULL`, asc(tasks.taskDate), asc(tasks.createdAt));

  return rows.map(mapTaskRow);
}

export async function loadExecPostponedTasksToday(
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
        eq(tasks.taskDate, istDate),
      ),
    )
    .orderBy(asc(tasks.createdAt));
  return rows.map(mapTaskRow);
}

export async function loadExecCompletedTasksToday(
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
        eq(tasks.status, 'completed'),
        eq(tasks.taskDate, istDate),
      ),
    )
    .orderBy(asc(tasks.createdAt));
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
  // Two queries: today scoped by task_date, rolled-over pending scoped by
  // the rolled_over_at flag. Pending = today_pending + rolled_pending.
  // (Postgres rejected a single GROUP BY query because the same parameter
  // bound twice gets distinct positional slots, so the two `task_date = $`
  // exprs in SELECT vs GROUP BY didn't match.)
  const [todayRows, rolledRow] = await Promise.all([
    db
      .select({
        status: tasks.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.execUserId, execUserId),
          eq(tasks.taskDate, istDate),
          inArray(tasks.status, ['pending', 'postponed', 'completed'] as const),
        ),
      )
      .groupBy(tasks.status),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.execUserId, execUserId),
          eq(tasks.status, 'pending'),
          sql`${tasks.rolledOverAt} IS NOT NULL`,
          // Don't double-count if the rolled-over row also has task_date=today
          // (shouldn't happen since the cron only rolls task_date < today,
          // but cheap to be defensive).
          sql`${tasks.taskDate} < ${istDate}::date`,
        ),
      ),
  ]);

  let pending = 0;
  let postponed = 0;
  let completed = 0;
  for (const r of todayRows) {
    if (r.status === 'pending') pending += r.count;
    else if (r.status === 'postponed') postponed += r.count;
    else if (r.status === 'completed') completed += r.count;
  }
  pending += rolledRow[0]?.count ?? 0;
  return { pending, postponed, completed };
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
