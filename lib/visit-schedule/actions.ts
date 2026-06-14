'use server';

import { alias } from 'drizzle-orm/pg-core';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';

import { db } from '@/db/client';
import { TIMEZONE } from '@/lib/date';
import {
  dayPlans,
  requestStatusHistory,
  statusStages,
  statusTransitions,
  tasks,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { dispatchNotification } from '@/lib/notifications/engine';

// =============================================================================
// Schedule-with-Calendar transactional writer
// =============================================================================
//
// HVA-253 (lifts the HVA-226 placeholder): generalised the legacy
// VISIT_SCHEDULED-only action into a generic "transition + pick a date +
// create an auto-task" action. The same dialog is now reused by every
// transition whose status_transitions row has `requires_datetime = true`
// AND `auto_task_type IS NOT NULL`.
//
// Behaviours kept identical to the pre-HVA-253 implementation for the
// VISIT_SCHEDULED path:
//   - Status flip current → next
//   - visit_requests.visit_scheduled_at = <picked datetime>
//     **only when toCode === 'VISIT_SCHEDULED'** (the column is purpose-
//     specific to the visit move — installation dates live only on the
//     auto-task row)
//   - tasks row created with the transition's auto_task_type, dated to
//     the picked day, linked to this request
//
// New behaviours (HVA-253):
//   - Transition + autoTaskType are looked up from status_transitions
//   - emits_event is read from the transition; null = no notification
//   - Notification context is per-event (visit-scheduled uses customer
//     WhatsApp template; installation-scheduled is internal-only)
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const scheduleSchema = z.object({
  requestId: z.string().uuid(),
  // HVA-253: callers MUST pass the target stage id so we look up the
  // right transition row + can decide downstream behavior generically.
  nextStatusId: z.string().uuid(),
  // Field name kept as `visitScheduledAt` for backward-compat with the
  // existing dialog. Semantically it's just "the picked datetime" — we
  // only write it to visit_requests.visit_scheduled_at on the
  // VISIT_SCHEDULED path.
  visitScheduledAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u, 'Pick a valid date + time'),
});

export type ScheduleVisitInput = z.infer<typeof scheduleSchema>;

// HVA-253: status_transitions.auto_task_type uses snake_case identifiers
// (matches the admin TASK_TYPES dropdown). The tasks.task_type enum is
// display-style. Map between the two.
const TASK_TYPE_DISPLAY: Record<
  string,
  'Outlet visit' | 'Customer home visit' | 'Sales pitch' | 'Follow-up' | 'Installation & Activation' | 'Stall Activity' | 'Other'
> = {
  customer_home_visit: 'Customer home visit',
  outlet_visit: 'Outlet visit',
  sales_pitch: 'Sales pitch',
  follow_up: 'Follow-up',
  installation: 'Installation & Activation',
  stall_activity: 'Stall Activity',
  other: 'Other',
};

// Default human-friendly task description per task type. Falls back to a
// generic "<verb> {customerName}" string when not listed.
function taskDescriptionFor(
  taskType: string,
  customerName: string,
): string {
  switch (taskType) {
    case 'customer_home_visit':
      return `Visit ${customerName}`;
    case 'installation':
      return `Install for ${customerName}`;
    case 'follow_up':
      return `Follow up with ${customerName}`;
    case 'sales_pitch':
      return `Sales pitch — ${customerName}`;
    default:
      return `Task — ${customerName}`;
  }
}

export async function scheduleVisitAction(
  input: ScheduleVisitInput,
): Promise<ActionResult<{ taskId: string | null }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (
    actor.role !== USER_ROLES.SALES_EXECUTIVE &&
    actor.role !== USER_ROLES.CAPTAIN &&
    actor.role !== USER_ROLES.SUPER_ADMIN
  ) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;
  const target = new Date(data.visitScheduledAt);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: 'Pick a valid date + time' };
  }
  if (target.getTime() <= Date.now()) {
    return { ok: false, error: 'Scheduled date must be in the future' };
  }

  // Load + auth.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      cancelledAt: visitRequests.cancelledAt,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      trackingToken: visitRequests.trackingToken,
      whatsappOptIn: visitRequests.whatsappOptIn,
      address: visitRequests.address,
      statusStageId: visitRequests.statusStageId,
      currentStageCode: statusStages.code,
      currentStageSeq: statusStages.sequenceNumber,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, data.requestId))
    .limit(1);
  if (!reqRow) return { ok: false, error: 'Request not found' };
  if (reqRow.cancelledAt !== null) {
    return { ok: false, error: 'Request is cancelled' };
  }

  // Per-row authz mirrors /api/requests/[id]/status.
  const isAdmin = actor.role === USER_ROLES.SUPER_ADMIN;
  if (!isAdmin) {
    if (actor.role === USER_ROLES.SALES_EXECUTIVE) {
      if (reqRow.assignedExecUserId !== actor.id) {
        return { ok: false, error: 'You are not the assigned executive' };
      }
    } else if (actor.role === USER_ROLES.CAPTAIN) {
      if (reqRow.assignedCaptainUserId !== actor.id) {
        return { ok: false, error: 'This request is not in your assigned city' };
      }
    }
  }

  if (!reqRow.assignedExecUserId) {
    return {
      ok: false,
      error: 'Assign the request to an executive before scheduling',
    };
  }

  // HVA-253: look up the target stage + the transition row generically.
  // Previously hardcoded to look up VISIT_SCHEDULED by code; now driven
  // by the nextStatusId the caller passes from advance-status-button.
  const fromStage = alias(statusStages, 'from_stage');
  const toStage = alias(statusStages, 'to_stage');
  const [transitionRow] = await db
    .select({
      id: statusTransitions.id,
      toStageId: statusTransitions.toStageId,
      toStageCode: toStage.code,
      toStageSeq: toStage.sequenceNumber,
      isActive: statusTransitions.isActive,
      requiresDatetime: statusTransitions.requiresDatetime,
      autoTaskType: statusTransitions.autoTaskType,
      emitsEvent: statusTransitions.emitsEvent,
    })
    .from(statusTransitions)
    .innerJoin(fromStage, eq(fromStage.id, statusTransitions.fromStageId))
    .innerJoin(toStage, eq(toStage.id, statusTransitions.toStageId))
    .where(
      and(
        eq(statusTransitions.fromStageId, reqRow.statusStageId),
        eq(statusTransitions.toStageId, data.nextStatusId),
      ),
    )
    .limit(1);
  if (!transitionRow) {
    return {
      ok: false,
      error: `No transition configured from ${reqRow.currentStageCode} to the requested stage`,
    };
  }
  if (!transitionRow.isActive) {
    return { ok: false, error: 'Transition is currently disabled' };
  }
  if (!transitionRow.requiresDatetime) {
    return {
      ok: false,
      error: 'This transition does not require a date+time picker',
    };
  }

  // Day-plan lookup: tasks link to the exec's day_plan when one exists
  // for the scheduled date; otherwise we leave day_plan_id NULL and let
  // the exec's Start-My-Day flow re-link on that date.
  // HVA-292 fix: the auto-task date + day-plan lookup must use the IST
  // calendar date of the picked moment, not the UTC date. A visit picked
  // for 00:00–05:30 IST resolves to the previous UTC day, which used to
  // file the task (and look up the day plan) one day early.
  const scheduledDateIso = formatInTimeZone(target, TIMEZONE, 'yyyy-MM-dd');
  const [planRow] = await db
    .select({ id: dayPlans.id })
    .from(dayPlans)
    .where(
      and(
        eq(dayPlans.execUserId, reqRow.assignedExecUserId),
        eq(dayPlans.planDate, scheduledDateIso),
      ),
    )
    .limit(1);

  const writesVisitScheduledAt =
    transitionRow.toStageCode === 'VISIT_SCHEDULED';
  const taskTypeDisplay = transitionRow.autoTaskType
    ? TASK_TYPE_DISPLAY[transitionRow.autoTaskType] ?? null
    : null;

  const now = new Date();
  let taskId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      // 1) status flip — write visit_scheduled_at only on the visit move
      const updateValues: Record<string, unknown> = {
        statusStageId: transitionRow.toStageId,
        updatedAt: now,
      };
      if (writesVisitScheduledAt) {
        updateValues.visitScheduledAt = target;
      }
      await tx
        .update(visitRequests)
        .set(updateValues)
        .where(eq(visitRequests.id, data.requestId));

      // 2) history row
      await tx.insert(requestStatusHistory).values({
        requestId: data.requestId,
        fromStatusStageId: reqRow.statusStageId,
        toStatusStageId: transitionRow.toStageId,
        sequenceNumber: transitionRow.toStageSeq,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${data.requestId}), 0) + 1`,
        changedByUserId: actor.id,
        // 2026-05-26 IST tz fix: must pin timeZone or the rendered string
        // is UTC-shifted from what the user actually picked.
        reason: `${transitionRow.toStageCode} scheduled for ${target.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
        })}`,
      });

      // 3) auto-task — only when the transition row has an auto_task_type
      if (taskTypeDisplay) {
        const [taskInsert] = await tx
          .insert(tasks)
          .values({
            execUserId: reqRow.assignedExecUserId!,
            dayPlanId: planRow?.id ?? null,
            taskType: taskTypeDisplay,
            description: taskDescriptionFor(
              transitionRow.autoTaskType!,
              reqRow.customerName,
            ),
            estimatedTime: '01:00',
            taskDate: scheduledDateIso,
            linkRequestId: data.requestId,
            linkLeadId: null,
            status: 'pending',
          })
          .returning({ id: tasks.id });
        taskId = taskInsert?.id ?? null;
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  // Audit (always — every scheduling action is recordable)
  await logEvent({
    eventType:
      transitionRow.toStageCode === 'VISIT_SCHEDULED'
        ? 'visit_scheduled'
        : 'status_change',
    actorUserId: actor.id,
    actorRole: actor.role as 'sales_executive' | 'captain' | 'super_admin',
    targetEntityType: 'visit_request',
    targetEntityId: data.requestId,
    beforeState: {
      statusStageCode: reqRow.currentStageCode,
      scheduledAt: null,
    },
    afterState: {
      statusStageCode: transitionRow.toStageCode,
      scheduledAt: target.toISOString(),
      autoCreatedTaskId: taskId,
    },
    reason: null,
  });

  // Notifications — fire only when the transition has an emits_event
  if (transitionRow.emitsEvent) {
    try {
      const context: Record<string, unknown> = {
        requestId: data.requestId,
        scheduledAt: target.toISOString(),
        customerName: reqRow.customerName,
        customerPhone: reqRow.customerPhone,
        trackingToken: reqRow.trackingToken,
        customerWhatsappOptIn: reqRow.whatsappOptIn,
      };
      // Preserve the existing field name for the visit-scheduled event
      // so the WhatsApp template body params keep resolving (the template
      // composer reads visitScheduledAt by name).
      if (writesVisitScheduledAt) {
        context.visitScheduledAt = target.toISOString();
      }
      await dispatchNotification(transitionRow.emitsEvent, context);
    } catch {
      // Never block on notification engine failure.
    }
  }

  revalidatePath('/', 'layout');
  return { ok: true, data: { taskId } };
}
