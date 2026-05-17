import { eq, sql } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import {
  REJECTION_REASONS,
  type RejectionReason,
} from '@/lib/rejection-reasons';
import { markCustomerRejectedSchema } from '@/lib/validators/mark-customer-rejected';

// =============================================================================
// HVA-69: POST /api/requests/[id]/mark-customer-rejected
// =============================================================================
//
// Terminal-state branch. The request stays at its current status_stage_id
// (we don't introduce a "Rejected" stage in the forward pipeline). The
// terminal flag is `visit_requests.cancelled_at IS NOT NULL` — the same
// axis HVA-39's column set was designed for. UI + downstream queries
// check that flag, not the status_stage_id.
//
// AUTH:
//   - Assigned sales_executive on the request
//   - Captain of the request's city (cities.captain_user_id = actor)
//   - super_admin (escape hatch)
//   - Captain of a different city / different exec → 403
//   - Anonymous → 401
//
// PRECONDITIONS:
//   1. Request exists.
//   2. cancelled_at IS NULL  — can't re-reject an already-terminal request.
//   3. status_stage_id != ORDER_EXECUTED_SUCCESSFULLY — completed orders
//      can't be retroactively rejected. (Captain Approve path will handle
//      late-stage reversals via HVA-80.)
//
// WRITES (single tx):
//   - visit_requests:
//       cancelled_at = now()
//       cancellation_actor = exec | captain | admin
//       cancelled_by_user_id = <actor>
//       cancellation_reason_code = <enum>  (HVA-69 new column)
//       cancellation_reason = <optional free-text note>
//       updated_at = now()
//   - request_status_history row (sequence_number = current; from = to
//     since we're not moving stages, but we still want a history entry
//     showing who marked rejected and when, with the reason+note).
//   - audit_log:  event_type='customer_rejection_marked',
//                 before_state={cancelled_at:null},
//                 after_state={cancelled_at, reason_code, note,
//                              actor: exec|captain|admin}.
//
// NOTIFICATION (HVA-48/49): captain + admin in-app + email — stubbed
// here, replaced when notification engine ships.
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.CAPTAIN,
  USER_ROLES.SUPER_ADMIN,
] as const;

/**
 * Map the actor's app-level role to the cancellation_actor enum value.
 * sales_executive → 'exec', captain → 'captain', super_admin → 'admin'.
 */
function cancellationActorFromRole(role: Role): 'exec' | 'captain' | 'admin' {
  if (role === USER_ROLES.SALES_EXECUTIVE) return 'exec';
  if (role === USER_ROLES.CAPTAIN) return 'captain';
  return 'admin';
}

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/mark-customer-rejected' });

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const reqHeaders = await headersFn();
  const requestId = reqHeaders.get('x-request-id') ?? undefined;
  const reqLog = apiLog.child({ requestId });

  // 1. Auth + role gate.
  let session;
  try {
    session = await requireAuth(ALLOWED_ROLES);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    throw err;
  }
  const actorUserId = session.user.id;
  const actorRole = (session.user as { role?: string }).role as Role;
  const isAdmin = actorRole === USER_ROLES.SUPER_ADMIN;

  // 2. Validate path.
  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      { ok: false, error: paramsParsed.error.issues[0]?.message ?? 'Invalid id' },
      { status: 400 },
    );
  }
  const requestUuid = paramsParsed.data.id;

  // 3. Validate body.
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const bodyParsed = markCustomerRejectedSchema.safeParse(bodyRaw);
  if (!bodyParsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of bodyParsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      { ok: false, error: 'Some fields are invalid.', fieldErrors },
      { status: 400 },
    );
  }
  const { reason, note } = bodyParsed.data;

  // 4. Load the request + its current stage + the request's city captain.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
      statusStageCode: statusStages.code,
      statusStageId: visitRequests.statusStageId,
      currentStageSeq: statusStages.sequenceNumber,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }

  // 5. Per-request authorization.
  if (!isAdmin) {
    let allowed = false;
    if (actorRole === USER_ROLES.SALES_EXECUTIVE) {
      allowed = reqRow.assignedExecUserId === actorUserId;
    } else if (actorRole === USER_ROLES.CAPTAIN) {
      allowed = reqRow.cityCaptainUserId === actorUserId;
    }
    if (!allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            actorRole === USER_ROLES.SALES_EXECUTIVE
              ? 'You are not the assigned executive for this request.'
              : "This request is not in your assigned city.",
        },
        { status: 403 },
      );
    }
  }

  // 6. Already-terminal guard.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is already marked rejected. Cannot re-mark.',
      },
      { status: 409 },
    );
  }
  if (reqRow.statusStageCode === 'ORDER_EXECUTED_SUCCESSFULLY') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Request is already fulfilled. Use captain override (HVA-80) for late-stage corrections.',
      },
      { status: 409 },
    );
  }

  // 7. Transactional write: visit_requests update + history entry.
  const cancellationActor = cancellationActorFromRole(actorRole);
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(visitRequests)
        .set({
          cancelledAt: now,
          cancellationActor,
          cancelledByUserId: actorUserId,
          cancellationReasonCode: reason,
          cancellationReason: note ?? null,
          updatedAt: now,
        })
        .where(eq(visitRequests.id, requestUuid));

      // History entry — sequence_number stays as the current stage's
      // seq (we're not moving stages, we're stamping a terminal flag).
      // The "REJECTED: " prefix on `reason` lets the timeline UI render
      // this entry distinctly.
      //
      // HVA-141: transition_order is the new per-request monotonic
      // counter that carries the UNIQUE constraint. The old
      // (request_id, sequence_number) UNIQUE was dropped in 0013, so
      // the previous ON CONFLICT DO NOTHING guard is no longer needed;
      // the cancelled_at gate earlier in this route is the actual
      // idempotency check.
      const reasonText = note
        ? `${REJECTION_REASONS[reason as RejectionReason]} — ${note}`
        : REJECTION_REASONS[reason as RejectionReason];
      await tx.insert(requestStatusHistory).values({
        requestId: requestUuid,
        fromStatusStageId: reqRow.statusStageId,
        toStatusStageId: reqRow.statusStageId,
        sequenceNumber: reqRow.currentStageSeq,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${requestUuid}), 0) + 1`,
        changedByUserId: actorUserId,
        reason: `REJECTED: ${reasonText}`,
      });
    });
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'mark_customer_rejected_tx_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 8. Audit log.
  await logEvent({
    eventType: 'customer_rejection_marked',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: {
      cancelledAt: null,
      statusStageCode: reqRow.statusStageCode,
    },
    afterState: {
      cancelledAt: now.toISOString(),
      cancellationActor,
      cancellationReasonCode: reason,
      cancellationReason: note ?? null,
      statusStageCode: reqRow.statusStageCode,
    },
    reason: note ?? null,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 9. Notification stub. HVA-48/49 will replace with captain + admin
  //    in-app + email fan-out ("Customer was rejected — request X closed").
  reqLog.info(
    {
      requestUuid,
      cancellationActor,
      reason,
      notificationEngine: 'pending_HVA-48',
    },
    'customer_rejection_marked_notification_pending',
  );

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      cancelledAt: now.toISOString(),
      cancellationActor,
      cancellationReasonCode: reason,
      cancellationReason: note ?? null,
    },
    { status: 200 },
  );
}
