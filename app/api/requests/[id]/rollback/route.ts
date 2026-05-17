import { and, desc, eq, lt } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, statusStages, users, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { transitionRequestStatus } from '@/lib/status-transition';
import { rollbackSchema } from '@/lib/validators/rollback';

// =============================================================================
// HVA-141: POST /api/requests/[id]/rollback
// =============================================================================
//
// Single-step backward transition. Moves the request from its current
// stage to the active stage at (currentSeq - 1). Allowed actors:
//   * super_admin   — always
//   * captain       — only if cities.captain_user_id === actorUserId
//   * sales_exec    — only if visit_requests.assigned_exec_user_id === actorUserId
//
// Stage gates (reject with 409):
//   * SUBMITTED                  — nothing to roll back to
//   * PENDING_CAPTAIN_APPROVAL   — Reject path handles this separately
//   * terminal (max seq active)  — no rollback from a final state
//   * request.cancelled_at set   — closed; no transitions
//
// Notification: in-app drawer fires for the city captain via the engine
// rule seeded in 0014_hva141_rolled_back_rule.sql.
//
// Multi-stage rollback is intentionally NOT supported. Caller wants
// to back up more than one step → call the route N times.
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.CAPTAIN,
  USER_ROLES.SUPER_ADMIN,
] as const;

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/rollback' });

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const reqHeaders = await headersFn();
  const correlationId = reqHeaders.get('x-request-id') ?? undefined;
  const reqLog = apiLog.child({ correlationId });

  // 1. Auth + role gate.
  let session;
  try {
    session = await requireAuth(ALLOWED_ROLES);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json(
        { ok: false, error: 'Forbidden' },
        { status: 403 },
      );
    }
    throw err;
  }
  const actorUserId = session.user.id;
  const actorRole = (session.user as { role?: string }).role as Role;
  const actorName =
    (session.user as { name?: string }).name ?? 'A teammate';
  const isAdmin = actorRole === USER_ROLES.SUPER_ADMIN;

  // 2. Validate path + body.
  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: paramsParsed.error.issues[0]?.message ?? 'Invalid id',
      },
      { status: 400 },
    );
  }
  const requestUuid = paramsParsed.data.id;

  let bodyRaw: unknown = {};
  // Body is optional (reason may be omitted). Tolerate empty body.
  if (req.headers.get('content-length') !== '0') {
    try {
      bodyRaw = await req.json();
    } catch {
      bodyRaw = {};
    }
  }
  const bodyParsed = rollbackSchema.safeParse(bodyRaw);
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
  const reason = bodyParsed.data.reason;

  // 3. Load request + current stage + city captain.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
      statusStageId: visitRequests.statusStageId,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
      statusStageSeq: statusStages.sequenceNumber,
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

  // 4. Terminal / cancelled gate.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is closed. No further status transitions.',
      },
      { status: 409 },
    );
  }

  // 5. Stage gates — rejected stages for rollback.
  if (reqRow.statusStageCode === 'SUBMITTED') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Cannot roll back from Submitted (no previous stage).',
      },
      { status: 409 },
    );
  }
  if (reqRow.statusStageCode === 'PENDING_CAPTAIN_APPROVAL') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Use Reject to move this back from Pending Captain Approval.',
      },
      { status: 409 },
    );
  }

  // 6. Per-request authorization. super_admin bypasses; captain must own
  //    the city; exec must be the assigned exec.
  if (!isAdmin) {
    let allowed = false;
    if (actorRole === USER_ROLES.CAPTAIN) {
      allowed = reqRow.cityCaptainUserId === actorUserId;
    } else if (actorRole === USER_ROLES.SALES_EXECUTIVE) {
      allowed = reqRow.assignedExecUserId === actorUserId;
    }
    if (!allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            actorRole === USER_ROLES.CAPTAIN
              ? 'This request is not in your assigned city.'
              : 'You are not the assigned executive for this request.',
        },
        { status: 403 },
      );
    }
  }

  // 7. Terminal-state gate — if currentSeq is the max active seq we
  //    refuse rollback. The brief calls this out separately from
  //    cancelled_at; both close the request to further movement.
  const [maxRow] = await db
    .select({ maxSeq: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);
  if (maxRow && reqRow.statusStageSeq >= maxRow.maxSeq) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Cannot roll back from a final state.',
      },
      { status: 409 },
    );
  }

  // 8. Resolve the previous active stage (highest seq < current).
  //    Using lt() + ORDER DESC LIMIT 1 (rather than seq = current-1) so
  //    a future admin-deactivated intermediate stage doesn't leave a
  //    captain stuck — the closest active predecessor is what the
  //    timeline shows.
  const [previousStage] = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(
      and(
        lt(statusStages.sequenceNumber, reqRow.statusStageSeq),
        eq(statusStages.isActive, true),
      ),
    )
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);

  if (!previousStage) {
    reqLog.error(
      { requestUuid, currentSeq: reqRow.statusStageSeq },
      'rollback_no_previous_stage',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // Validate the resolved previous stage is exactly seq-1. If an admin
  // deactivated an intermediate stage we land on a further predecessor;
  // surface that as a 409 rather than silently rolling back N stages —
  // multi-stage rollback is out of scope this ship.
  if (previousStage.sequenceNumber !== reqRow.statusStageSeq - 1) {
    reqLog.warn(
      {
        requestUuid,
        currentSeq: reqRow.statusStageSeq,
        resolvedSeq: previousStage.sequenceNumber,
      },
      'rollback_gap_in_active_stages',
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          'Cannot roll back: an intermediate stage is inactive. Ask admin to re-enable it.',
      },
      { status: 409 },
    );
  }

  // 9. Run the transition with allowRollback. The service writes the
  //    request_status_history row (with the new HVA-141 transition_order)
  //    and the status_change audit row inside its own tx.
  const result = await transitionRequestStatus({
    requestId: requestUuid,
    nextStatusId: previousStage.id,
    actorUserId,
    actorRole,
    reason,
    allowRollback: true,
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, transitionError: result.error },
      'rollback_transition_failed',
    );
    const { status, ...body } = result;
    return NextResponse.json(body, { status });
  }

  // 10. Action-named audit row carrying the actor + reason in a single
  //     queryable event. The service already wrote 'status_change'; the
  //     dedicated 'status_rolled_back' lets dashboards count rollbacks
  //     without scanning every status_change's before/after seq.
  await logEvent({
    eventType: 'status_rolled_back',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: {
      statusStageId: reqRow.statusStageId,
      statusStageCode: reqRow.statusStageCode,
      statusStageName: reqRow.statusStageName,
      sequenceNumber: reqRow.statusStageSeq,
    },
    afterState: {
      statusStageId: previousStage.id,
      statusStageCode: previousStage.code,
      statusStageName: previousStage.name,
      sequenceNumber: previousStage.sequenceNumber,
    },
    reason,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 11. In-app dispatch to the city captain — fire-and-forget. Engine
  //     never throws; the .catch is the last-resort guard for the
  //     Promise wiring itself.
  //
  //     actorName comes from session.user.name (better-auth's mapping
  //     onto users.full_name). When the actor IS the captain (they
  //     rolled back their own city's request), the rule still fires
  //     and the captain sees a self-targeted notification — acceptable
  //     UX, matches /assign's request.assigned which also fires for
  //     captain_assigning even when admin acts on behalf.
  if (reqRow.cityCaptainUserId) {
    setImmediate(() => {
      dispatchNotification('request.rolled_back', {
        requestId: requestUuid,
        customerName: reqRow.customerName,
        cityCaptainUserId: reqRow.cityCaptainUserId,
        actorUserId,
        actorName,
        fromStageId: reqRow.statusStageId,
        fromStageName: reqRow.statusStageName,
        toStageId: previousStage.id,
        toStageName: previousStage.name,
        reason,
      }).catch((err) => {
        reqLog.error(
          {
            requestUuid,
            err: err instanceof Error ? err.message : String(err),
          },
          'rollback_dispatch_failed',
        );
      });
    });
  } else {
    // Defensive: city has no captain assigned (uncommon — admin should
    // fix the city row). Skip the dispatch and log the gap.
    reqLog.warn(
      { requestUuid },
      'rollback_skipped_captain_dispatch_no_city_captain',
    );
  }

  // Resolve actor full_name for the response shape — used by the toast
  // on the client side. Not load-bearing; failure of this lookup
  // shouldn't 500 the rollback.
  let actorFullName: string | null = null;
  try {
    const [u] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1);
    actorFullName = u?.fullName ?? null;
  } catch {
    actorFullName = null;
  }

  // HVA-143: invalidate the client Router Cache so sibling pages
  // (e.g. /captain/requests, /track) see the rolled-back state on
  // the next navigation.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      previousStage: result.previous,
      currentStage: result.current,
      actor: { id: actorUserId, fullName: actorFullName },
    },
    { status: 200 },
  );
}
