// =============================================================================
// Task-sync — keep the linked visit `tasks` row in step with the request
// =============================================================================
//
// A scheduled visit lives in TWO places: visit_requests.visit_scheduled_at /
// assigned_exec_user_id, AND a `tasks` row (its own exec_user_id, day_plan_id,
// task_date, status). The exec's /today reads tasks by day_plan_id; the
// calendars read by exec_user_id + date and dedupe the visit event away when a
// task exists. So a mutation that updates the request but forgets the task
// leaves a stale ghost on the wrong day/exec — and hides the corrected event.
//
// These helpers re-anchor / move / cancel that linked task so reschedule,
// reassign and cancel all propagate to the exec's calendar + day plan. Each is
// a no-op when there is no linked pending visit task (legacy / lead tasks).
// All run inside the caller's transaction.
// =============================================================================

import { and, eq, inArray } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';

import { db } from '@/db/client';
import { dayPlans, tasks } from '@/db/schema';
import { TIMEZONE } from '@/lib/date';
import { VISIT_TASK_TYPES } from '@/lib/metrics/constants';

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// HVA-318: task types that represent a SCHEDULED APPOINTMENT attached to a
// request — the set every helper in this file operates on.
//
// This was previously VISIT_TASK_TYPES, which omits 'Installation &
// Activation'. That made all three helpers below silent no-ops for
// installation tasks: reassigning an exec did not move their installation
// work, cancelling a request did not cancel the installation task, and
// rescheduling left it anchored to the old day.
//
// It is deliberately NOT the same list as VISIT_TASK_TYPES. That constant is
// a METRICS concept — "what counts as a visit" for conversion and visit
// counts — and it is duplicated across six report/dashboard files. Widening
// it would silently change reported numbers, which is a different decision
// from fixing task sync.
const APPOINTMENT_TASK_TYPES = [
  ...VISIT_TASK_TYPES,
  'Installation & Activation',
] as const;

const VISIT_TYPES =
  APPOINTMENT_TASK_TYPES as unknown as readonly (typeof VISIT_TASK_TYPES)[number][];

/** Find (or create) the OPEN day plan for an exec on an IST date. Returns the
 *  plan id, or null when the matching plan exists but is closed (we never move
 *  a task into a closed plan — leave day_plan_id as-is in that case). */
async function findOrCreateDayPlan(
  tx: DbTx,
  execUserId: string,
  planDate: string,
): Promise<string | null> {
  const [existing] = await tx
    .select({ id: dayPlans.id, closedAt: dayPlans.closedAt })
    .from(dayPlans)
    .where(
      and(eq(dayPlans.execUserId, execUserId), eq(dayPlans.planDate, planDate)),
    )
    .limit(1);
  if (existing) return existing.closedAt === null ? existing.id : null;
  const [created] = await tx
    .insert(dayPlans)
    .values({
      execUserId,
      planDate,
      scheduledVisitCount: 0,
      additionalTaskCount: 1,
      isLate: false,
    })
    .returning({ id: dayPlans.id });
  return created?.id ?? null;
}

/** The linked pending visit task for a request, if any. */
async function loadLinkedVisitTask(
  tx: DbTx,
  requestId: string,
): Promise<{ id: string; execUserId: string; taskDate: string } | null> {
  const [task] = await tx
    .select({
      id: tasks.id,
      execUserId: tasks.execUserId,
      taskDate: tasks.taskDate,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.linkRequestId, requestId),
        eq(tasks.status, 'pending'),
        inArray(tasks.taskType, VISIT_TYPES),
      ),
    )
    .limit(1);
  return task ?? null;
}

/** Reschedule: move the linked task to the new moment's IST date AND repoint
 *  day_plan_id to that date's plan (for the task's current exec). */
export async function reanchorVisitTaskToDate(
  tx: DbTx,
  requestId: string,
  newAt: Date,
): Promise<void> {
  const task = await loadLinkedVisitTask(tx, requestId);
  if (!task) return;
  const newDate = formatInTimeZone(newAt, TIMEZONE, 'yyyy-MM-dd');
  const planId = await findOrCreateDayPlan(tx, task.execUserId, newDate);
  await tx
    .update(tasks)
    .set({
      taskDate: newDate,
      ...(planId ? { dayPlanId: planId } : {}),
      // no longer a rolled-over task — it's legitimately on its new date.
      rolledOverAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));
}

/** Reassign: move the linked task to a new exec AND repoint day_plan_id to that
 *  exec's plan for the task's current date, so it leaves the old exec's
 *  calendar/plan and lands on the new exec's. */
export async function moveVisitTaskToExec(
  tx: DbTx,
  requestId: string,
  newExecUserId: string,
): Promise<void> {
  const task = await loadLinkedVisitTask(tx, requestId);
  if (!task || task.execUserId === newExecUserId) return;
  const planId = await findOrCreateDayPlan(tx, newExecUserId, task.taskDate);
  await tx
    .update(tasks)
    .set({
      execUserId: newExecUserId,
      ...(planId ? { dayPlanId: planId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));
}

/** Cancel: mark the linked pending visit task cancelled so the exec no longer
 *  sees a live visit for a cancelled request. */
export async function cancelLinkedVisitTask(
  tx: DbTx,
  requestId: string,
): Promise<void> {
  await tx
    .update(tasks)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(tasks.linkRequestId, requestId),
        eq(tasks.status, 'pending'),
        inArray(tasks.taskType, VISIT_TYPES),
      ),
    );
}
