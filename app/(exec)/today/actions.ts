'use server';

import { and, eq, isNotNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { dayPlans, leads, postponeReasons, tasks, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { canExecEditTask } from '@/lib/exec/edit-auth';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
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

/**
 * HVA-170-FIX1: find-or-create the day_plans row for (exec, date). Idempotent
 * across races via the unique (exec_user_id, plan_date) index. Returns
 * the row's id on success; an error result on a sealed plan or unreachable
 * insert.
 *
 * Today-dated case routes through loadOpenDayPlan (today's plan must
 * exist via Start My Day) — caller is responsible for that branch.
 * This helper handles non-today dates only.
 */
async function findOrCreateFutureDayPlan(
  execUserId: string,
  taskDate: string,
): Promise<{ ok: true; planId: string } | { ok: false; error: string }> {
  const existing = await db
    .select({ id: dayPlans.id, closedAt: dayPlans.closedAt })
    .from(dayPlans)
    .where(
      and(eq(dayPlans.execUserId, execUserId), eq(dayPlans.planDate, taskDate)),
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].closedAt !== null) {
      return { ok: false, error: 'That day plan is already closed' };
    }
    return { ok: true, planId: existing[0].id };
  }
  await db
    .insert(dayPlans)
    .values({
      execUserId,
      planDate: taskDate,
      scheduledVisitCount: 0,
      additionalTaskCount: 1,
      isLate: false,
    })
    .onConflictDoNothing();
  const [reloaded] = await db
    .select({ id: dayPlans.id })
    .from(dayPlans)
    .where(
      and(eq(dayPlans.execUserId, execUserId), eq(dayPlans.planDate, taskDate)),
    )
    .limit(1);
  if (!reloaded) {
    return { ok: false, error: 'Could not create day plan' };
  }
  return { ok: true, planId: reloaded.id };
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
  /** HVA-73 follow-up: tasks may link to a lead instead of a request. */
  linkLeadId?: string | null;
  /**
   * Task calendar picker: YYYY-MM-DD in IST. Default = today.
   * Allowed window: [today, today+30]. When > today, this action
   * auto-creates the matching future day_plan row if one doesn't exist.
   */
  taskDate?: string | null;
}

const FUTURE_TASK_WINDOW_DAYS = 30;

function ymdAddDays(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map((s) => Number(s));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + deltaDays);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // HVA-73 follow-up: link_request_id XOR link_lead_id (or both null).
  // No DB CHECK constraint; app-side enforcement is authoritative.
  if (input.linkRequestId && input.linkLeadId) {
    return {
      ok: false,
      error: 'A task can link to a request OR a lead, not both',
    };
  }

  // Task date picker (defaults to today IST). Server-side bounds check.
  const todayIst = getIstDateString();
  const maxIst = ymdAddDays(todayIst, FUTURE_TASK_WINDOW_DAYS);
  const taskDate = input.taskDate ?? todayIst;
  if (!ISO_DATE_RE.test(taskDate)) {
    return { ok: false, error: 'Task date must be YYYY-MM-DD' };
  }
  if (taskDate < todayIst) {
    return { ok: false, error: 'Task date cannot be in the past' };
  }
  if (taskDate > maxIst) {
    return {
      ok: false,
      error: `Task date cannot be more than ${FUTURE_TASK_WINDOW_DAYS} days out`,
    };
  }

  // Today-dated tasks: today's plan must already exist (the Start My
  // Day button shipped the row). Future-dated tasks: look up via the
  // shared findOrCreateFutureDayPlan helper (HVA-170-FIX1) — same
  // path moveTaskAction uses.
  let targetPlanId: string;
  if (taskDate === todayIst) {
    const plan = await loadOpenDayPlan(auth.actor.id);
    if (plan === null) return { ok: false, error: 'Start your day first' };
    if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };
    targetPlanId = plan.id;
  } else {
    const found = await findOrCreateFutureDayPlan(auth.actor.id, taskDate);
    if (!found.ok) return found;
    targetPlanId = found.planId;
  }

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

  // HVA-73 PR 3: validate lead visibility before linking. Visibility
  // broadens beyond captor — if the actor has ever been assigned to a
  // contact-linked request, they can link tasks against that contact.
  // Super_admin still goes through the captor-only narrow path since
  // visibility isn't defined for them (they have no assignment trail).
  if (input.linkLeadId) {
    const [lead] = await db
      .select({ id: leads.id, capturedByUserId: leads.capturedByUserId })
      .from(leads)
      .where(eq(leads.id, input.linkLeadId))
      .limit(1);
    if (!lead) {
      return { ok: false, error: 'Lead not found' };
    }
    if (auth.actor.role === 'super_admin') {
      if (lead.capturedByUserId !== auth.actor.id) {
        return { ok: false, error: 'Lead not captured by you' };
      }
    } else {
      const visibleIds = await loadExecVisibleContactIds(auth.actor.id);
      if (!visibleIds.includes(input.linkLeadId)) {
        return { ok: false, error: 'Lead is not visible to you' };
      }
    }
  }

  const [inserted] = await db
    .insert(tasks)
    .values({
      execUserId: auth.actor.id,
      dayPlanId: targetPlanId,
      taskType: input.taskType as TaskType,
      description,
      estimatedTime: input.estimatedTime,
      taskDate,
      linkRequestId: input.linkRequestId ?? null,
      linkLeadId: input.linkLeadId ?? null,
    })
    .returning({ id: tasks.id });

  revalidatePath('/', 'layout');
  return { ok: true, data: { taskId: inserted.id } };
}

// -----------------------------------------------------------------------------
// editTaskAction — HVA-159: edit a pending or postponed task
// -----------------------------------------------------------------------------
//
// Editable fields: description, taskDate, estimatedTime, linkRequestId,
// linkLeadId. status enum is pending|completed|postponed|cancelled —
// canExecEditTask refuses completed + cancelled, so editTask only ever
// touches pending or postponed rows.
//
// Same picker-side semantics as addTaskAction: XOR on the two link
// columns, lead-link goes through the visibility set, request-link must
// be assigned to me. taskDate change reuses the future-day-plan
// auto-create path so a moved-forward task lands on the right plan.

export interface EditTaskInput {
  taskId: string;
  description: string;
  taskDate: string; // YYYY-MM-DD
  estimatedTime: string;
  linkRequestId?: string | null;
  linkLeadId?: string | null;
}

export async function editTaskAction(
  input: EditTaskInput,
): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const allowed = await canExecEditTask(auth.actor.id, input.taskId);
  if (!allowed) return { ok: false, error: 'Task is not editable by you' };

  // Field validation (mirrors addTaskAction's guards).
  if (!ESTIMATED_TIME_BUCKETS.includes(
    input.estimatedTime as EstimatedTimeBucket,
  )) {
    return { ok: false, error: 'Unknown estimated time bucket' };
  }
  const description = input.description.trim();
  if (description.length < 5 || description.length > 200) {
    return { ok: false, error: 'Description must be 5–200 characters' };
  }

  if (!ISO_DATE_RE.test(input.taskDate)) {
    return { ok: false, error: 'Task date must be YYYY-MM-DD' };
  }
  const todayIst = getIstDateString();
  const maxIst = ymdAddDays(todayIst, FUTURE_TASK_WINDOW_DAYS);
  if (input.taskDate < todayIst) {
    return { ok: false, error: 'Task date cannot be in the past' };
  }
  if (input.taskDate > maxIst) {
    return {
      ok: false,
      error: `Task date cannot be more than ${FUTURE_TASK_WINDOW_DAYS} days out`,
    };
  }

  // XOR rule on link columns.
  if (input.linkRequestId && input.linkLeadId) {
    return {
      ok: false,
      error: 'A task can link to a request OR a lead, not both',
    };
  }

  // Request-link must belong to actor (defence-in-depth).
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

  // Lead-link visibility (PR 3): captor OR assignment trail. super_admin
  // keeps the narrow captor-only path.
  if (input.linkLeadId) {
    const [lead] = await db
      .select({ id: leads.id, capturedByUserId: leads.capturedByUserId })
      .from(leads)
      .where(eq(leads.id, input.linkLeadId))
      .limit(1);
    if (!lead) return { ok: false, error: 'Lead not found' };
    if (auth.actor.role === 'super_admin') {
      if (lead.capturedByUserId !== auth.actor.id) {
        return { ok: false, error: 'Lead not captured by you' };
      }
    } else {
      const visibleIds = await loadExecVisibleContactIds(auth.actor.id);
      if (!visibleIds.includes(input.linkLeadId)) {
        return { ok: false, error: 'Lead is not visible to you' };
      }
    }
  }

  // Load the existing task (auth check already validated ownership).
  const [existing] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, input.taskId))
    .limit(1);
  if (!existing) return { ok: false, error: 'Task not found' };

  // taskDate may move forward to a future day with no day_plan yet.
  // Reuse the find-or-create-plan flow from addTaskAction so the row
  // lands on the right plan.
  let targetPlanId: string;
  if (input.taskDate === todayIst) {
    const todayPlan = await loadOpenDayPlan(auth.actor.id);
    if (todayPlan === null) {
      return { ok: false, error: 'Start your day first' };
    }
    if (todayPlan.closedAt !== null) {
      return { ok: false, error: 'Day is closed' };
    }
    targetPlanId = todayPlan.id;
  } else {
    const futureExisting = await db
      .select({ id: dayPlans.id, closedAt: dayPlans.closedAt })
      .from(dayPlans)
      .where(
        and(
          eq(dayPlans.execUserId, auth.actor.id),
          eq(dayPlans.planDate, input.taskDate),
        ),
      )
      .limit(1);
    if (futureExisting[0]) {
      if (futureExisting[0].closedAt !== null) {
        return { ok: false, error: 'That day plan is already closed' };
      }
      targetPlanId = futureExisting[0].id;
    } else {
      await db
        .insert(dayPlans)
        .values({
          execUserId: auth.actor.id,
          planDate: input.taskDate,
          scheduledVisitCount: 0,
          additionalTaskCount: 1,
          isLate: false,
        })
        .onConflictDoNothing();
      const [reloaded] = await db
        .select({ id: dayPlans.id })
        .from(dayPlans)
        .where(
          and(
            eq(dayPlans.execUserId, auth.actor.id),
            eq(dayPlans.planDate, input.taskDate),
          ),
        )
        .limit(1);
      if (!reloaded) {
        return { ok: false, error: 'Could not create day plan' };
      }
      targetPlanId = reloaded.id;
    }
  }

  const next = {
    description,
    estimatedTime: input.estimatedTime,
    taskDate: input.taskDate,
    linkRequestId: input.linkRequestId ?? null,
    linkLeadId: input.linkLeadId ?? null,
    dayPlanId: targetPlanId,
  };

  const fieldsToDiff: Array<keyof typeof next> = [
    'description',
    'estimatedTime',
    'taskDate',
    'linkRequestId',
    'linkLeadId',
    'dayPlanId',
  ];
  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const f of fieldsToDiff) {
    const b = (existing as unknown as Record<string, unknown>)[f as string];
    const a = (next as unknown as Record<string, unknown>)[f as string];
    const bn = b ?? null;
    const an = a ?? null;
    if (bn !== an) {
      beforeState[f as string] = bn;
      afterState[f as string] = an;
    }
  }

  if (Object.keys(afterState).length === 0) {
    return { ok: true };
  }

  await db
    .update(tasks)
    .set(next)
    .where(eq(tasks.id, input.taskId));

  await logEvent({
    eventType: 'task_edited',
    actorUserId: auth.actor.id,
    actorRole: isRole(auth.actor.role) ? auth.actor.role : null,
    targetEntityType: 'task',
    targetEntityId: input.taskId,
    beforeState,
    afterState,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
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

  // Ownership check via exec_user_id. HVA-171 walk fix: the previous
  // `eq(tasks.dayPlanId, plan.id)` predicate coupled the action to TODAY'S
  // plan, which broke Mark-as-Done on rolled-over tasks (whose dayPlanId
  // points to the originating day's plan). Ownership is fully established
  // by exec_user_id; the dayPlanId clause was "defence in depth" against
  // a non-real UUIDv7 collision risk.
  const [task] = await db
    .select({
      id: tasks.id,
      createdAt: tasks.createdAt,
      taskType: tasks.taskType,
      status: tasks.status,
      taskDate: tasks.taskDate,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, input.taskId),
        eq(tasks.execUserId, auth.actor.id),
      ),
    )
    .limit(1);
  if (!task) return { ok: false, error: 'Task not found' };

  // Future-task guard is now load-bearing — without the dayPlanId filter
  // above, rolled-over tasks from past plans can flow through this action
  // legitimately, but a future-dated task still must not be marked done
  // before its day. The /dashboard Pending accordion (HVA-169) is the
  // entry point that surfaces non-today tasks.
  const todayIstForGuard = getIstDateString();
  if (task.taskDate > todayIstForGuard) {
    return {
      ok: false,
      error: 'This task is scheduled for the future — mark it done on its day',
    };
  }

  // Free-text mode requires non-empty notes; chip mode requires an
  // outcomeOptionId. The UI enforces this too but server-side is
  // authoritative.
  const isFreeText =
    task.taskType === 'Outlet visit' ||
    task.taskType === 'Stall Activity' ||
    task.taskType === 'Other';

  if (isFreeText) {
    const notes = (input.outcomeNotes ?? '').trim();
    // Bug 2 fix: client-side gate relaxed from 5 to non-empty; server
    // mirrors that as the belt-and-braces validator. Upper bound stays
    // at 500 chars (matches the textarea maxLength).
    if (notes.length === 0 || notes.length > 500) {
      return { ok: false, error: 'Notes must be 1–500 characters' };
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

  // HVA-171 walk fix: drop the `eq(tasks.dayPlanId, plan.id)` predicate
  // so undo works on rolled-over tasks too. Ownership stays via exec_user_id.
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
      ),
    );

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// undoPostponeAction — revert a postponed task back to pending
// -----------------------------------------------------------------------------
//
// HVA-60 design polish (walk-3): pairs with the icon-only Undo button now
// rendered on every postponed task card. Clears every postpone field
// (postponeReasonId / postponedToDate / customerInformed) and flips the
// status back to 'pending'. Same closed-day guard as the mark-done undo —
// once the day is sealed, no mutations allowed.
//
// Symmetric to undoMarkDoneAction above. Tests #5 + #6 in
// tests/today/today-loop.test.ts cover the happy path and the 403.

export async function undoPostponeAction(taskId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const plan = await loadOpenDayPlan(auth.actor.id);
  if (plan === null) return { ok: false, error: 'Start your day first' };
  if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };

  // HVA-171 walk fix: drop the `eq(tasks.dayPlanId, plan.id)` predicate
  // so undo works on rolled-over postponed tasks too.
  await db
    .update(tasks)
    .set({
      status: 'pending',
      postponeReasonId: null,
      postponedToDate: null,
      customerInformed: null,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.execUserId, auth.actor.id),
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

  // HVA-171 walk fix: drop the `eq(tasks.dayPlanId, plan.id)` predicate
  // so Postpone works on rolled-over tasks too.
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

// -----------------------------------------------------------------------------
// moveTaskAction — HVA-170-FIX1: move a pending/postponed task's date.
// -----------------------------------------------------------------------------
//
// Replaces the clone-on-Pending/Postponed flow that shipped with HVA-170
// and produced duplicate rows. For pending tasks: bumps `task_date` and
// re-anchors `day_plan_id` to the destination day's plan. For postponed
// tasks: bumps `postponed_to_date` only (task_date stays as the original
// enrollment date — audit trail). Status, link_request_id, link_lead_id
// are preserved; no re-validation of links (D14) — the exec is not
// adding a new link, just rescheduling existing work.
//
// Date validation: newDate ∈ [today_ist, today_ist + 30 days].
// Status guard: completed + cancelled tasks reject explicitly.
//
// No audit row written (parallels addTaskAction / postponeTaskAction
// which don't emit per-event audit either; this is a quiet
// reschedule, not a stage transition).
// =============================================================================

export interface MoveTaskInput {
  taskId: string;
  /** YYYY-MM-DD IST. Must be in [today, today+30]. */
  newDate: string;
}

export async function moveTaskAction(input: MoveTaskInput): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  if (!ISO_DATE_RE.test(input.newDate)) {
    return { ok: false, error: 'Date must be YYYY-MM-DD' };
  }
  const todayIst = getIstDateString();
  const maxIst = ymdAddDays(todayIst, FUTURE_TASK_WINDOW_DAYS);
  if (input.newDate < todayIst) {
    return { ok: false, error: 'Date must be today or future' };
  }
  if (input.newDate > maxIst) {
    return {
      ok: false,
      error: `Date must be within ${FUTURE_TASK_WINDOW_DAYS} days`,
    };
  }

  // Ownership + status guard. exec_user_id alone is enough for
  // authorisation (HVA-171 walk fix removed the dayPlanId predicate
  // trap). Status is what gates the action — only pending/postponed
  // are movable.
  const [task] = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      taskDate: tasks.taskDate,
      postponedToDate: tasks.postponedToDate,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, input.taskId),
        eq(tasks.execUserId, auth.actor.id),
      ),
    )
    .limit(1);
  if (!task) return { ok: false, error: 'Not your task' };
  if (task.status !== 'pending' && task.status !== 'postponed') {
    return {
      ok: false,
      error: 'Only pending or postponed tasks can be moved',
    };
  }

  if (task.status === 'pending') {
    // Resolve destination plan. Today-dated moves use today's open
    // plan (refuse if Start My Day hasn't fired or day is closed);
    // future-dated moves use the find-or-create helper.
    let targetPlanId: string;
    if (input.newDate === todayIst) {
      const plan = await loadOpenDayPlan(auth.actor.id);
      if (plan === null) return { ok: false, error: 'Start your day first' };
      if (plan.closedAt !== null) return { ok: false, error: 'Day is closed' };
      targetPlanId = plan.id;
    } else {
      const found = await findOrCreateFutureDayPlan(auth.actor.id, input.newDate);
      if (!found.ok) return found;
      targetPlanId = found.planId;
    }

    await db
      .update(tasks)
      .set({
        taskDate: input.newDate,
        dayPlanId: targetPlanId,
        // HVA-169 roll-over: clear the stamp so the moved row is no
        // longer surfaced under "rolled over from past" — it's now a
        // legitimate task on its new date.
        rolledOverAt: null,
      })
      .where(eq(tasks.id, task.id));
  } else {
    // Postponed: only postponed_to_date changes. Keep task_date as
    // the historical original (audit). dayPlanId stays anchored
    // to the original plan.
    await db
      .update(tasks)
      .set({
        postponedToDate: input.newDate,
      })
      .where(eq(tasks.id, task.id));
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
