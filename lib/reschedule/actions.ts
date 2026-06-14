'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { formatInTimeZone } from 'date-fns-tz';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  requestRescheduleHistory,
  statusStages,
  tasks,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { TIMEZONE } from '@/lib/date';
import { VISIT_TASK_TYPES } from '@/lib/metrics/constants';
import { dispatchNotification } from '@/lib/notifications/engine';

// =============================================================================
// HVA-72 (2B): reschedule data flow
// =============================================================================
//
// Two write paths:
//   * exec — authenticated; must be the assigned exec on the request
//   * customer — token in URL is the credential
//
// Both write the same shape: bump visit_scheduled_at, increment
// reschedule_count, insert a request_reschedule_history row, fire
// audit + notification. Status stays VISIT_SCHEDULED (or whatever it
// was) — reschedule is a side event, not a forward stage transition.
//
// Captain approval gate (per spec §10.2) is deferred to a follow-up
// ticket; option 2B explicitly skipped it.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const FUTURE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?$/u;

const execRescheduleSchema = z.object({
  requestId: z.string().uuid(),
  toVisitScheduledAt: z
    .string()
    .regex(FUTURE_ISO_RE, 'Pick a valid date + time'),
  reason: z
    .string()
    .trim()
    .min(10, 'Reason must be at least 10 characters')
    .max(500, 'Reason must be 500 characters or fewer'),
});

export type ExecRescheduleInput = z.infer<typeof execRescheduleSchema>;

export async function rescheduleByExecAction(
  input: ExecRescheduleInput,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (
    actor.role !== USER_ROLES.SALES_EXECUTIVE &&
    actor.role !== USER_ROLES.SUPER_ADMIN
  ) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = execRescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;
  const target = new Date(data.toVisitScheduledAt);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: 'Pick a valid date + time' };
  }
  if (target.getTime() <= Date.now()) {
    return { ok: false, error: 'New date must be in the future' };
  }

  return commonReschedule({
    requestId: data.requestId,
    toAt: target,
    reason: data.reason,
    actorUserId: actor.id,
    actorRole: actor.role === USER_ROLES.SALES_EXECUTIVE ? 'sales_executive' : 'super_admin',
    authCheck: async (row) => {
      // Sales-exec must own the request. super_admin escape hatch.
      if (actor.role === USER_ROLES.SUPER_ADMIN) return null;
      if (row.assignedExecUserId !== actor.id) {
        return 'You are not the assigned executive for this request';
      }
      return null;
    },
  });
}

// -----------------------------------------------------------------------------
// Customer-initiated — called from app/api/track/[token]/reschedule
// -----------------------------------------------------------------------------

const customerRescheduleSchema = z.object({
  token: z.string().min(8).max(64),
  toVisitScheduledAt: z
    .string()
    .regex(FUTURE_ISO_RE, 'Pick a valid date + time'),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('')),
});

export type CustomerRescheduleInput = z.infer<typeof customerRescheduleSchema>;

export async function rescheduleByCustomerAction(
  input: CustomerRescheduleInput,
): Promise<ActionResult> {
  const parsed = customerRescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;
  const target = new Date(data.toVisitScheduledAt);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: 'Pick a valid date + time' };
  }
  if (target.getTime() <= Date.now()) {
    return { ok: false, error: 'New date must be in the future' };
  }

  // Token → request lookup.
  const [tokenLookup] = await db
    .select({ id: visitRequests.id })
    .from(visitRequests)
    .where(eq(visitRequests.trackingToken, data.token))
    .limit(1);
  if (!tokenLookup) return { ok: false, error: 'Request not found' };

  return commonReschedule({
    requestId: tokenLookup.id,
    toAt: target,
    reason:
      data.reason && data.reason.length > 0
        ? `Customer rescheduled: ${data.reason}`
        : 'Customer rescheduled (no reason given)',
    actorUserId: null,
    actorRole: null,
    authCheck: async () => null, // token is the credential
  });
}

// -----------------------------------------------------------------------------
// Shared transactional writer
// -----------------------------------------------------------------------------

interface CommonRescheduleArgs {
  requestId: string;
  toAt: Date;
  reason: string;
  actorUserId: string | null;
  actorRole: 'sales_executive' | 'super_admin' | null;
  authCheck: (row: {
    assignedExecUserId: string | null;
  }) => Promise<string | null>;
}

async function commonReschedule(
  args: CommonRescheduleArgs,
): Promise<ActionResult> {
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      visitScheduledAt: visitRequests.visitScheduledAt,
      rescheduleCount: visitRequests.rescheduleCount,
      statusStageCode: statusStages.code,
      cancelledAt: visitRequests.cancelledAt,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      trackingToken: visitRequests.trackingToken,
      whatsappOptIn: visitRequests.whatsappOptIn,
      // 2026-05-29: city join so request.rescheduled dispatch can resolve
      // the captain_owning_city recipient + render the city.
      cityCaptainUserId: cities.captainUserId,
      cityName: cities.name,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(visitRequests.id, args.requestId))
    .limit(1);
  if (!reqRow) return { ok: false, error: 'Request not found' };

  if (reqRow.cancelledAt !== null) {
    return { ok: false, error: 'Request is cancelled — cannot reschedule' };
  }
  if (reqRow.statusStageCode === 'ORDER_EXECUTED_SUCCESSFULLY') {
    return { ok: false, error: 'Order already executed — cannot reschedule' };
  }

  const authErr = await args.authCheck({
    assignedExecUserId: reqRow.assignedExecUserId,
  });
  if (authErr) return { ok: false, error: authErr };

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(visitRequests)
        .set({
          visitScheduledAt: args.toAt,
          rescheduleCount: sql`${visitRequests.rescheduleCount} + 1`,
          updatedAt: now,
        })
        .where(eq(visitRequests.id, args.requestId));

      // HVA-292: move the linked open visit task to the new date so the
      // exec's plan + the calendar follow the reschedule. Without this the
      // calendar kept showing the visit on the old day (the stale task
      // dedupes away the new-date visit event). IST calendar date of the
      // picked moment.
      const newTaskDate = formatInTimeZone(args.toAt, TIMEZONE, 'yyyy-MM-dd');
      await tx
        .update(tasks)
        .set({ taskDate: newTaskDate, updatedAt: now })
        .where(
          and(
            eq(tasks.linkRequestId, args.requestId),
            eq(tasks.status, 'pending'),
            inArray(
              tasks.taskType,
              VISIT_TASK_TYPES as unknown as readonly (typeof VISIT_TASK_TYPES)[number][],
            ),
          ),
        );

      await tx.insert(requestRescheduleHistory).values({
        requestId: args.requestId,
        fromVisitScheduledAt: reqRow.visitScheduledAt,
        toVisitScheduledAt: args.toAt,
        rescheduledByUserId: args.actorUserId,
        reason: args.reason,
      });
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  await logEvent({
    eventType: 'request_rescheduled',
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: args.requestId,
    beforeState: {
      visitScheduledAt: reqRow.visitScheduledAt?.toISOString() ?? null,
      rescheduleCount: reqRow.rescheduleCount,
    },
    afterState: {
      visitScheduledAt: args.toAt.toISOString(),
      rescheduleCount: reqRow.rescheduleCount + 1,
    },
    reason: args.reason,
  });

  try {
    await dispatchNotification('request.rescheduled', {
      requestId: args.requestId,
      toVisitScheduledAt: args.toAt.toISOString(),
      reason: args.reason,
      customerName: reqRow.customerName,
      // HVA-47: customer-facing WhatsApp inputs.
      customerPhone: reqRow.customerPhone,
      trackingToken: reqRow.trackingToken,
      // HVA-79: opt-in gate.
      customerWhatsappOptIn: reqRow.whatsappOptIn,
      // 2026-05-29: needed for the captain_owning_city recipient resolver
      // + the composer's "in <city>" suffix.
      cityCaptainUserId: reqRow.cityCaptainUserId,
      cityName: reqRow.cityName,
      // 2026-05-30: engine resolver for exec_assigned reads context.execUserId.
      execUserId: reqRow.assignedExecUserId,
    });
  } catch {
    // Never block the response.
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
