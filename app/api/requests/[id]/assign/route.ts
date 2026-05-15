import { and, eq, isNull } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { log } from '@/lib/logger';
import { transitionRequestStatus } from '@/lib/status-transition';

// =============================================================================
// HVA-81: captain assigns an unassigned Submitted request to an exec
// =============================================================================
//
// POST /api/requests/[id]/assign  body: { execUserId, note? }
//
// AUTH: captain or super_admin only. Forbidden for sales_executive.
//
// VALIDATION CHAIN (each step gates the next):
//   1. Request exists.
//   2. Request's city is in the actor's assigned cities (super_admin
//      bypasses — escape-hatch identical to HVA-99 reasoning; admins
//      need to assign on behalf for support).
//   3. Target exec belongs to the actor's team (sales_executives row
//      with captain_user_id = actor). super_admin again bypasses —
//      they can assign across teams for support.
//   4. Request currently has NULL assigned_exec_user_id.
//   5. Current stage IS Submitted (the only stage from which assignment
//      is valid; forward-only validator below would also reject).
//
// EXECUTION (single transaction via the shared service):
//   - Via lib/status-transition.transitionRequestStatus with a preUpdate
//     hook that UPDATEs assigned_exec_user_id, assigned_captain_user_id,
//     and assigned_at on visit_requests. The status_stage_id update
//     (Submitted → Assigned) + request_status_history insert run in
//     the same tx.
//   - On commit: write audit_log 'request_assigned'.
//   - TODO(HVA-48/HVA-49): dispatch 'request.assigned' notification
//     (customer WhatsApp + exec push).
//
// Captain bookkeeping:
//   - assigned_captain_user_id is set to the ACTING captain on first
//     assignment. For super_admin doing the assignment, set to the
//     city's owning captain (cities.captain_user_id) so the request
//     still belongs to the right captain in dashboards. If the city
//     has no captain assigned (uncommon — admin should fix the city
//     row), leave NULL and let the audit show super_admin acted alone.
// =============================================================================

const ALLOWED_ROLES = ['captain', 'super_admin'] as const;
const apiLog = log.child({ route: '/api/requests/[id]/assign' });

const bodySchema = z.object({
  execUserId: z.string().uuid('execUserId must be a valid UUID'),
  note: z.string().trim().max(1000).optional(),
});
const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  req: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
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
  const actorRole = (session.user as { role?: string }).role as
    | 'captain'
    | 'super_admin';
  const isAdmin = actorRole === 'super_admin';

  // 2. Validate path + body.
  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      { ok: false, error: paramsParsed.error.issues[0]?.message ?? 'Invalid id' },
      { status: 400 },
    );
  }
  const requestUuid = paramsParsed.data.id;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const bodyParsed = bodySchema.safeParse(bodyRaw);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { ok: false, error: bodyParsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 },
    );
  }
  const { execUserId, note } = bodyParsed.data;

  // 3. Load the request + the current stage. Surface 404 cleanly if missing.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      cityId: visitRequests.cityId,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      assignedExecUserId: visitRequests.assignedExecUserId,
      statusStageCode: statusStages.code,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json(
      { ok: false, error: 'Request not found' },
      { status: 404 },
    );
  }

  // 4. City ownership gate. super_admin bypasses.
  if (!isAdmin && reqRow.cityCaptainUserId !== actorUserId) {
    return NextResponse.json(
      { ok: false, error: 'Request is not in your assigned cities.' },
      { status: 403 },
    );
  }

  // 5. Already-assigned guard. Stay safe against concurrent double-assigns.
  if (reqRow.assignedExecUserId !== null) {
    return NextResponse.json(
      { ok: false, error: 'Request is already assigned.' },
      { status: 409 },
    );
  }

  // 6. Stage guard. Assignment only valid from Submitted. The forward-only
  //    transition service would also reject any other stage, but failing
  //    here gives the client a more specific error.
  if (reqRow.statusStageCode !== 'SUBMITTED') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is not in Submitted state — cannot assign.',
      },
      { status: 409 },
    );
  }

  // 7. Exec validation: must exist, must report to this captain (or to the
  //    city's captain if the actor is super_admin assisting).
  const captainOwnerId = isAdmin ? reqRow.cityCaptainUserId : actorUserId;
  if (!captainOwnerId) {
    return NextResponse.json(
      { ok: false, error: 'City has no captain assigned. Admin must fix the city row first.' },
      { status: 409 },
    );
  }

  const [execRow] = await db
    .select({
      userId: salesExecutives.userId,
      captainUserId: salesExecutives.captainUserId,
      isUnavailable: salesExecutives.isUnavailable,
      fullName: users.fullName,
      isActive: users.isActive,
      role: users.role,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(eq(salesExecutives.userId, execUserId))
    .limit(1);

  if (!execRow) {
    return NextResponse.json(
      { ok: false, error: 'Target user is not a sales executive.' },
      { status: 400 },
    );
  }
  if (execRow.captainUserId !== captainOwnerId) {
    return NextResponse.json(
      { ok: false, error: 'Exec is not on your team.' },
      { status: 403 },
    );
  }
  if (!execRow.isActive) {
    return NextResponse.json(
      { ok: false, error: 'Exec is inactive.' },
      { status: 409 },
    );
  }
  // is_unavailable is captured but doesn't block assignment in HVA-81 —
  // HVA-85 ships the workflow that gates here. For now: allow + audit
  // captures the flag value via the actor's intent.

  // 8. Look up the Assigned stage id to feed the transition service.
  const [assignedStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'ASSIGNED'))
    .limit(1);
  if (!assignedStage) {
    reqLog.error({}, 'assigned_stage_not_seeded');
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 9. Execute the assignment + transition atomically. preUpdate runs
  //    INSIDE the same tx as the status update + history insert.
  const result = await transitionRequestStatus({
    requestId: requestUuid,
    nextStatusId: assignedStage.id,
    actorUserId,
    actorRole,
    reason: note,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
    preUpdate: async (tx) => {
      // Defence-in-depth: re-check unassigned inside the tx so two
      // concurrent assigns can't both succeed. Drizzle's returning() lets
      // us count affected rows.
      const updated = await tx
        .update(visitRequests)
        .set({
          assignedExecUserId: execRow.userId,
          assignedCaptainUserId: captainOwnerId,
          assignedAt: new Date(),
        })
        .where(
          and(
            eq(visitRequests.id, requestUuid),
            isNull(visitRequests.assignedExecUserId),
          ),
        )
        .returning({ id: visitRequests.id });
      if (updated.length === 0) {
        // Lost the race: another captain or admin assigned this between
        // our pre-flight check and the tx start. Throwing rolls back
        // the whole transaction; the service surfaces TX_FAILED to the
        // caller, who maps to 503. Acceptable — the client can refresh.
        throw new Error('assign_race_lost');
      }
    },
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, execUserId, transitionError: result.error },
      'assign_transition_failed',
    );
    const { status, ...body } = result;
    return NextResponse.json(body, { status });
  }

  // 10. Audit row for the ASSIGNMENT (status_change row already written
  //     by transitionRequestStatus). 'request_assigned' added to the
  //     audit_enabled_events allow-list in this issue.
  await logEvent({
    eventType: 'request_assigned',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: { assignedExecUserId: null },
    afterState: {
      assignedExecUserId: execRow.userId,
      assignedExecName: execRow.fullName,
      assignedCaptainUserId: captainOwnerId,
      cityName: reqRow.cityName,
    },
    reason: note ?? null,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 11. Notification engine — STUB. HVA-48 (multi-channel dispatch) and
  //     HVA-49 (WhatsApp/email transport) replace this with the real
  //     fan-out: customer WhatsApp ("Our team is preparing your visit")
  //     + exec in-app + push.
  // TODO(HVA-48/HVA-49): dispatchNotification('request.assigned', {
  //   requestId: requestUuid,
  //   execUserId: execRow.userId,
  //   captainUserId: captainOwnerId,
  // })
  reqLog.info(
    {
      requestUuid,
      execUserId: execRow.userId,
      captainUserId: captainOwnerId,
      notificationEngine: 'pending_HVA-48',
    },
    'request_assigned_notification_pending',
  );

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      assignedExec: { id: execRow.userId, fullName: execRow.fullName },
      previousStage: result.previous,
      currentStage: result.current,
    },
    { status: 200 },
  );
}

export type AssignSuccessResponse = {
  ok: true;
  requestId: string;
  assignedExec: { id: string; fullName: string };
  previousStage: { id: string; name: string; sequenceNumber: number };
  currentStage: { id: string; name: string; sequenceNumber: number };
};
