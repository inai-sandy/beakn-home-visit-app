'use server';

import { and, eq, isNotNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { dayPlans, postponeReasons, tasks, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';
import {
  ESTIMATED_TIME_BUCKETS,
  formatMinutesAsBucket,
  getIstDateString,
  type EstimatedTimeBucket,
} from '@/lib/today/time';

// =============================================================================
// HVA-60: Server Actions powering the exec /today daily loop
// =============================================================================
//
// Every action shares the same outer shape:
//   1. session + role gate (sales_executive | super_admin)
//   2. lookup the current day_plan
//   3. closed-day guard — refuse mutations once day_plans.closed_at is set
//   4. tx the write
//   5. revalidatePath('/', 'layout') per HVA-143
//
// The closed-day guard runs server-side in every action. Even if the UI
// hides the buttons after close, a stale tab + manual refetch shouldn't
// be able to mutate a sealed day.
//
// Status writes use 'completed' (Δ1 of HVA-60 recon). UI labels say "Done".
// Task type comparisons use the exact pgEnum Title-Case strings (Δ2).
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const ALLOWED_ROLES = ['sales_executive', 'super_admin'] as const;

interface Actor {
  id: string;
  role: 'sales_executive' | 'super_admin';
}

async function authorize(): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const u = session.user as { id: string; role?: string };
  if (!ALLOWED_ROLES.includes(u.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, actor: { id: u.id, role: u.role as Actor['role'] } };
}

async function loadOpenDayPlan(execUserId: string) {
  const [row] = await db
    .select({
      id: dayPlans.id,
      submittedAt: dayPlans.submittedAt,
      closedAt: dayPlans.closedAt,
      planDate: dayPlans.planDate,
    })
    .from(dayPlans)
    .where(
      and(
        eq(dayPlans.execUserId, execUserId),
        eq(dayPlans.planDate, getIstDateString()),
      ),
    )
    .limit(1);
  return row ?? null;
}

// -----------------------------------------------------------------------------
// startDayAction — insert today's day_plans row, idempotent.
// -----------------------------------------------------------------------------

export async function startDayAction(): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const istDate = getIstDateString();

  // INSERT ... ON CONFLICT DO NOTHING via the unique (exec_user_id, plan_date)
  // index. A second click while the row already exists is a no-op success.
  await db
    .insert(dayPlans)
    .values({
      execUserId: auth.actor.id,
      planDate: istDate,
      // submittedAt defaults to NOW() per schema.
      // scheduledVisitCount / additionalTaskCount default to 0.
      // isLate default false (pre-spec: HVA-?? will compute against cutoff).
    })
    .onConflictDoNothing();

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// addTaskAction — insert a new task tied to today's day_plan.
// -----------------------------------------------------------------------------

const TASK_TYPES = [
  'Outlet visit',
  'Customer home visit',
  'Sales pitch',
  'Follow-up',
  'Installation & Activation',
  'Stall Activity',
  'Other',
] as const;
type TaskType = (typeof TASK_TYPES)[number];

export interface AddTaskInput {
  taskType: string;
  description: string;
  estimatedTime: string;
  linkRequestId?: string | null;
}

export async function addTaskAction(input: AddTaskInput): Promise<ActionResult<{ taskId: string }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  if (!TASK_TYPES.includes(input.taskType as TaskType)) {
    return { ok: false, error: 'Unknown task type' };
  }
  if (!ESTIMATED_TIME_BUCKETS.includes(input.estimatedTime as EstimatedTimeBucket)) {
    return { ok: false, error: 'Unknown estimated time bucket' };
  }
  const description = input.description.trim();
  if (description.length < 5 || description.length > 200) {
    return { ok: false, error: 'Description must be 5–200 characters' };
  }

  const plan = await loadOpenDayPlan(auth.actor.id);
  if (plan === null) return { ok: false, error: 'Start your day first' };
  if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };

  // Validate optional request link belongs to this exec (defence-in-depth;
  // UI only suggests own requests).
  if (input.linkRequestId) {
    const [req] = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.id, input.linkRequestId),
          eq(visitRequests.assignedExecUserId, auth.actor.id),
        ),
      )
      .limit(1);
    if (!req) return { ok: false, error: 'Request not assigned to you' };
  }

  const [inserted] = await db
    .insert(tasks)
    .values({
      execUserId: auth.actor.id,
      dayPlanId: plan.id,
      taskType: input.taskType as TaskType,
      description,
      estimatedTime: input.estimatedTime,
      taskDate: plan.planDate,
      linkRequestId: input.linkRequestId ?? null,
    })
    .returning({ id: tasks.id });

  revalidatePath('/', 'layout');
  return { ok: true, data: { taskId: inserted.id } };
}

// -----------------------------------------------------------------------------
// markTaskDoneAction — write outcome (chip OR free text) + status='completed'
// -----------------------------------------------------------------------------

export interface MarkTaskDoneInput {
  taskId: string;
  /** Required for chip mode. Null for free-text mode. */
  outcomeOptionId: string | null;
  /** Required for free-text mode (5–500 chars). Optional notes for chip mode. */
  outcomeNotes: string | null;
}

export async function markTaskDoneAction(
  input: MarkTaskDoneInput,
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const plan = await loadOpenDayPlan(auth.actor.id);
  if (plan === null) return { ok: false, error: 'Start your day first' };
  if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };

  // Load the task with ownership check. The exec_user_id eq + day_plan_id
  // eq pair prevents tampering with another exec's task or a previous-day
  // task that happens to share an id collision (UUIDv7 makes that
  // collision-prone, but defence in depth).
  const [task] = await db
    .select({
      id: tasks.id,
      createdAt: tasks.createdAt,
      taskType: tasks.taskType,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, input.taskId),
        eq(tasks.execUserId, auth.actor.id),
        eq(tasks.dayPlanId, plan.id),
      ),
    )
    .limit(1);
  if (!task) return { ok: false, error: 'Task not found' };

  // Free-text mode requires non-empty notes; chip mode requires an
  // outcomeOptionId. The UI enforces this too but server-side is
  // authoritative.
  const isFreeText =
    task.taskType === 'Outlet visit' ||
    task.taskType === 'Stall Activity' ||
    task.taskType === 'Other';

  if (isFreeText) {
    const notes = (input.outcomeNotes ?? '').trim();
    if (notes.length < 5 || notes.length > 500) {
      return { ok: false, error: 'Notes must be 5–500 characters' };
    }
    input.outcomeNotes = notes;
    input.outcomeOptionId = null;
  } else {
    if (!input.outcomeOptionId) {
      return { ok: false, error: 'Pick an outcome' };
    }
    if (input.outcomeNotes !== null) {
      const notes = input.outcomeNotes.trim();
      input.outcomeNotes = notes === '' ? null : notes;
    }
  }

  // Compute actual_time bucket from createdAt → now.
  const elapsedMs = Date.now() - task.createdAt.getTime();
  const elapsedMins = Math.max(1, Math.round(elapsedMs / 60_000));
  const actualBucket = formatMinutesAsBucket(elapsedMins);

  await db
    .update(tasks)
    .set({
      status: 'completed',
      outcomeOptionId: input.outcomeOptionId,
      outcomeNotes: input.outcomeNotes,
      completedAt: new Date(),
      actualTime: actualBucket,
    })
    .where(eq(tasks.id, input.taskId));

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// undoMarkDoneAction — revert a just-completed task back to pending
// -----------------------------------------------------------------------------

export async function undoMarkDoneAction(taskId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const plan = await loadOpenDayPlan(auth.actor.id);
  if (plan === null) return { ok: false, error: 'Start your day first' };
  if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };

  await db
    .update(tasks)
    .set({
      status: 'pending',
      outcomeOptionId: null,
      outcomeNotes: null,
      completedAt: null,
      actualTime: null,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.execUserId, auth.actor.id),
        eq(tasks.dayPlanId, plan.id),
      ),
    );

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// postponeTaskAction — UPDATE tasks SET status='postponed' + reason/date/informed
// -----------------------------------------------------------------------------

export interface PostponeTaskInput {
  taskId: string;
  reasonId: string;
  /** YYYY-MM-DD, IST-day-shifted. */
  postponedToDate: string;
  customerInformed: boolean;
}

export async function postponeTaskAction(input: PostponeTaskInput): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const plan = await loadOpenDayPlan(auth.actor.id);
  if (plan === null) return { ok: false, error: 'Start your day first' };
  if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };

  // Confirm reasonId exists (defence-in-depth; UI picks from a known list).
  const [reason] = await db
    .select({ id: postponeReasons.id })
    .from(postponeReasons)
    .where(and(eq(postponeReasons.id, input.reasonId), eq(postponeReasons.isActive, true)))
    .limit(1);
  if (!reason) return { ok: false, error: 'Unknown postpone reason' };

  // Date sanity: must be a parseable YYYY-MM-DD, today..today+30.
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(input.postponedToDate)) {
    return { ok: false, error: 'Invalid date format' };
  }
  const today = getIstDateString();
  if (input.postponedToDate < today) {
    return { ok: false, error: 'Postpone date is in the past' };
  }
  // Soft 30-day window (UI also enforces). Allow today (effectively a no-op
  // postpone) for now; the UI defaults to tomorrow.

  const updated = await db
    .update(tasks)
    .set({
      status: 'postponed',
      postponeReasonId: input.reasonId,
      postponedToDate: input.postponedToDate,
      customerInformed: input.customerInformed,
    })
    .where(
      and(
        eq(tasks.id, input.taskId),
        eq(tasks.execUserId, auth.actor.id),
        eq(tasks.dayPlanId, plan.id),
      ),
    )
    .returning({ id: tasks.id });
  if (updated.length === 0) return { ok: false, error: 'Task not found' };

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// closeDayAction — UPDATE day_plans SET closed_at = NOW()
// -----------------------------------------------------------------------------

export interface CloseDayInput {
  /** Snapshot values shown to the user on the Close screen. Recorded for
   *  historical replay so a future audit doesn't have to recompute the
   *  exact numbers from raw rows. */
  amountCollectedPaise: number;
  quotationsSubmittedToday: number;
}

export async function closeDayAction(input: CloseDayInput): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const plan = await loadOpenDayPlan(auth.actor.id);
  if (plan === null) return { ok: false, error: 'No open day plan' };
  if (plan.closedAt !== null) return { ok: false, error: 'Day already closed' };

  await db
    .update(dayPlans)
    .set({
      closedAt: new Date(),
      amountCollectedPaise: input.amountCollectedPaise,
      quotationsSubmittedToday: input.quotationsSubmittedToday,
    })
    .where(and(eq(dayPlans.id, plan.id), isNotNull(dayPlans.execUserId)));

  log.info(
    { actorUserId: auth.actor.id, dayPlanId: plan.id },
    'day_plan_closed',
  );

  revalidatePath('/', 'layout');
  return { ok: true };
}
