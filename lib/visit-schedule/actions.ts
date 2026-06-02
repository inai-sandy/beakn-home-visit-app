'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  dayPlans,
  requestStatusHistory,
  statusStages,
  tasks,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { dispatchNotification } from '@/lib/notifications/engine';

// =============================================================================
// Schedule-Visit transactional writer
// =============================================================================
//
// "Advance to Visit Scheduled" used to be a one-tap status flip that
// never touched visit_scheduled_at. That meant Calendar/Reschedule/
// Rebalance had nothing to anchor on. This action wraps three writes:
//
//   1. Status: current -> VISIT_SCHEDULED (existing forward-only logic
//      mirrored from /api/requests/[id]/status, but inline so the
//      transaction holds the same lock as the other writes)
//   2. visit_requests.visit_scheduled_at = <picked datetime>
//   3. tasks: auto-create one Customer-home-visit task for the assigned
//      exec on the scheduled date, linked to this request, so the visit
//      lands on /today and /calendar without manual entry
//
// Auth: assigned sales exec, captain owning the request's city, or
// super_admin. Mirrors the matrix in /api/requests/[id]/status.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const scheduleSchema = z.object({
  requestId: z.string().uuid(),
  visitScheduledAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u, 'Pick a valid date + time'),
});

export type ScheduleVisitInput = z.infer<typeof scheduleSchema>;

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
    return { ok: false, error: 'Visit date must be in the future' };
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

  // Find the VISIT_SCHEDULED stage.
  const [visitStage] = await db
    .select({
      id: statusStages.id,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(eq(statusStages.code, 'VISIT_SCHEDULED'))
    .limit(1);
  if (!visitStage) {
    return { ok: false, error: 'VISIT_SCHEDULED stage missing' };
  }
  if (visitStage.sequenceNumber <= reqRow.currentStageSeq) {
    return {
      ok: false,
      error: `Request is already past Visit Scheduled (currently at ${reqRow.currentStageCode})`,
    };
  }

  // Day-plan lookup: tasks link to the exec's day_plan when one exists
  // for the visit date; otherwise we leave day_plan_id NULL and let the
  // exec's Start-My-Day flow re-link on that date.
  const visitDateIso = target.toISOString().slice(0, 10);
  const [planRow] = await db
    .select({ id: dayPlans.id })
    .from(dayPlans)
    .where(
      and(
        eq(dayPlans.execUserId, reqRow.assignedExecUserId),
        eq(dayPlans.planDate, visitDateIso),
      ),
    )
    .limit(1);

  const now = new Date();
  let taskId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      // 1) status flip
      await tx
        .update(visitRequests)
        .set({
          statusStageId: visitStage.id,
          visitScheduledAt: target,
          updatedAt: now,
        })
        .where(eq(visitRequests.id, data.requestId));

      // 2) history row
      await tx.insert(requestStatusHistory).values({
        requestId: data.requestId,
        fromStatusStageId: reqRow.statusStageId,
        toStatusStageId: visitStage.id,
        sequenceNumber: visitStage.sequenceNumber,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${data.requestId}), 0) + 1`,
        changedByUserId: actor.id,
        // 2026-05-26 IST tz fix: without timeZone this rendered UTC into
        // the audit/timeline reason. The timeline reads this string
        // verbatim, so the user saw "06:30" or similar instead of the
        // 12:00 they picked.
        reason: `Visit scheduled for ${target.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
        })}`,
      });

      // 3) auto-task for the assigned exec on that date
      const [taskInsert] = await tx
        .insert(tasks)
        .values({
          execUserId: reqRow.assignedExecUserId!,
          dayPlanId: planRow?.id ?? null,
          taskType: 'Customer home visit',
          description: `Visit ${reqRow.customerName}`,
          estimatedTime: '01:00',
          taskDate: visitDateIso,
          linkRequestId: data.requestId,
          linkLeadId: null,
          status: 'pending',
        })
        .returning({ id: tasks.id });
      taskId = taskInsert?.id ?? null;
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  await logEvent({
    eventType: 'visit_scheduled',
    actorUserId: actor.id,
    actorRole: actor.role as 'sales_executive' | 'captain' | 'super_admin',
    targetEntityType: 'visit_request',
    targetEntityId: data.requestId,
    beforeState: {
      statusStageCode: reqRow.currentStageCode,
      visitScheduledAt: null,
    },
    afterState: {
      statusStageCode: 'VISIT_SCHEDULED',
      visitScheduledAt: target.toISOString(),
      autoCreatedTaskId: taskId,
    },
    reason: null,
  });

  try {
    await dispatchNotification('request.scheduled', {
      requestId: data.requestId,
      visitScheduledAt: target.toISOString(),
      customerName: reqRow.customerName,
      // HVA-47: customer-facing WhatsApp uses customerPhone (the
      // `customer` recipient role resolves to it via directAddress).
      // trackingToken populates the {{N}} tracking-URL placeholder.
      customerPhone: reqRow.customerPhone,
      trackingToken: reqRow.trackingToken,
      // HVA-79: opt-in gate.
      customerWhatsappOptIn: reqRow.whatsappOptIn,
    });
  } catch {
    // Never block on notification engine failure.
  }

  revalidatePath('/', 'layout');
  return { ok: true, data: { taskId } };
}
