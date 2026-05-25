import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import {
  TRACK_CANCEL_REASON_LABELS,
  trackCancelSchema,
} from '@/lib/validators/track-cancel';

// =============================================================================
// HVA-39: POST /api/track/[token]/cancel — customer-initiated cancellation
// =============================================================================
//
// Public endpoint. The tracking_token in the URL is the credential — there
// is no session, no role check. The token is generated as nanoid(21) per
// HVA-33; unguessable in practice.
//
// PRECONDITIONS:
//   1. Token resolves to a visit_request.
//   2. cancelled_at IS NULL — can't re-cancel.
//   3. statusStageCode != ORDER_EXECUTED_SUCCESSFULLY — completed orders
//      can't be retroactively cancelled by the customer (use exec/captain
//      flow for late-stage reversals).
//
// WRITES (single tx):
//   - visit_requests:
//       cancelled_at = now()
//       cancellation_actor = 'customer'
//       cancelled_by_user_id = NULL  (customer has no users row)
//       cancellation_reason_code = <enum>  (whitelist via lib/validators/track-cancel)
//       cancellation_reason = <optional free-text note>
//       updated_at = now()
//   - request_status_history row (sequence_number = current; from = to)
//     prefixed with "CANCELLED_BY_CUSTOMER: " for timeline rendering
//   - audit_log: event_type='request_cancelled_by_customer'
//   - notification engine: 'request.cancelled_by_customer' event for
//     fan-out to captain + admin (HVA-50 will seed rules)
// =============================================================================

const paramsSchema = z.object({
  token: z
    .string()
    .min(8, 'Invalid tracking token')
    .max(64, 'Invalid tracking token'),
});

interface Ctx {
  params: Promise<{ token: string }>;
}

const apiLog = log.child({ route: '/api/track/[token]/cancel' });

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const reqHeaders = await headersFn();
  const requestId = reqHeaders.get('x-request-id') ?? undefined;
  const reqLog = apiLog.child({ requestId });

  // 1. Validate path param.
  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: paramsParsed.error.issues[0]?.message ?? 'Invalid token',
      },
      { status: 400 },
    );
  }
  const { token } = paramsParsed.data;

  // 2. Validate body.
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }
  const bodyParsed = trackCancelSchema.safeParse(bodyRaw);
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

  // 3. Load request by token.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      cancelledAt: visitRequests.cancelledAt,
      statusStageId: visitRequests.statusStageId,
      statusStageCode: statusStages.code,
      currentStageSeq: statusStages.sequenceNumber,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      cityId: visitRequests.cityId,
      customerName: visitRequests.customerName,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.trackingToken, token))
    .limit(1);
  if (!reqRow) {
    return NextResponse.json(
      { ok: false, error: 'Request not found' },
      { status: 404 },
    );
  }

  // 4. Already-terminal guards.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is already cancelled.',
      },
      { status: 409 },
    );
  }
  if (reqRow.statusStageCode === 'ORDER_EXECUTED_SUCCESSFULLY') {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Your order is already complete. Please contact support to discuss any changes.",
      },
      { status: 409 },
    );
  }

  // 5. Transactional write.
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(visitRequests)
        .set({
          cancelledAt: now,
          cancellationActor: 'customer',
          cancelledByUserId: null,
          cancellationReasonCode: reason,
          cancellationReason: note ?? null,
          updatedAt: now,
        })
        .where(eq(visitRequests.id, reqRow.id));

      const reasonText = note
        ? `${TRACK_CANCEL_REASON_LABELS[reason]} — ${note}`
        : TRACK_CANCEL_REASON_LABELS[reason];
      await tx.insert(requestStatusHistory).values({
        requestId: reqRow.id,
        fromStatusStageId: reqRow.statusStageId,
        toStatusStageId: reqRow.statusStageId,
        sequenceNumber: reqRow.currentStageSeq,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${reqRow.id}), 0) + 1`,
        changedByUserId: null,
        reason: `CANCELLED_BY_CUSTOMER: ${reasonText}`,
      });
    });
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'track_cancel_tx_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 6. Audit log. actor_user_id is NULL because the customer has no
  //    users row; actor_role 'customer' identifies the source.
  // actorRole is constrained to the users.role enum (sales_executive /
  // captain / super_admin). Customer cancellations have no user row, so
  // actorRole is null; the afterState carries cancellationActor='customer'
  // for the diff trail.
  await logEvent({
    eventType: 'request_cancelled_by_customer',
    actorUserId: null,
    actorRole: null,
    targetEntityType: 'visit_request',
    targetEntityId: reqRow.id,
    beforeState: {
      cancelledAt: null,
      statusStageCode: reqRow.statusStageCode,
    },
    afterState: {
      cancelledAt: now.toISOString(),
      cancellationActor: 'customer',
      cancellationReasonCode: reason,
      cancellationReason: note ?? null,
      statusStageCode: reqRow.statusStageCode,
    },
    reason: note ?? null,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 7. Notification fan-out. HVA-50 will seed rules for this event so the
  //    captain + admin see it via in-app + email. Until then this is a
  //    silent no-op (engine returns 0 deliveries).
  try {
    await dispatchNotification('request.cancelled_by_customer', {
      requestId: reqRow.id,
      cityId: reqRow.cityId,
      assignedExecUserId: reqRow.assignedExecUserId,
      assignedCaptainUserId: reqRow.assignedCaptainUserId,
      customerName: reqRow.customerName,
      reasonCode: reason,
      reasonNote: note ?? null,
    });
  } catch (err) {
    // Never block the response on notification engine failure.
    reqLog.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'track_cancel_notification_dispatch_failed',
    );
  }

  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      requestId: reqRow.id,
      cancelledAt: now.toISOString(),
      cancellationReasonCode: reason,
      cancellationReason: note ?? null,
    },
    { status: 200 },
  );
}
