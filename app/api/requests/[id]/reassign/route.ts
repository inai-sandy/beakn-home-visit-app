import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  requestExecAssignments,
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
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { reassignSchema } from '@/lib/validators/reassign';

// =============================================================================
// HVA-140: POST /api/requests/[id]/reassign
// =============================================================================
//
// Captain (or super_admin) replaces the currently-assigned exec on a
// request that has already been assigned. The status_stage_id is
// UNCHANGED — flow continues from where the previous exec left off.
//
// Distinct from HVA-81's /assign route which handles INITIAL assignment
// at the Submitted → Assigned transition.
//
// AUTH:
//   * captain — must own the request's city (cities.captain_user_id)
//   * super_admin — bypasses the city gate
//   * sales_executive — 403 (cannot self-reassign or peer-reassign)
//
// VALIDATION (each step gates the next):
//   1. body { newExecUserId: uuid, reason: 50..500 chars }
//   2. Request exists.
//   3. Request not cancelled.
//   4. Request not terminal (max active seq).
//   5. Request has an assigned_exec_user_id (otherwise use /assign).
//   6. Target exec exists, is_active, role = sales_executive.
//   7. Target exec is on the captain's team (salesExecutives.captainUserId
//      = actorUserId; super_admin bypasses).
//   8. Target exec is NOT already the assigned one.
//
// WRITES (single tx):
//   * UPDATE visit_requests SET assigned_exec_user_id = new, updated_at = now()
//   * INSERT request_exec_assignments(request_id, from, to, captain, reason)
//
// AFTER COMMIT:
//   * audit_log: request_reassigned with before/after exec + reason
//   * setImmediate(dispatchNotification('request.reassigned', context)) —
//     fans out to in-app (removed + assigned) and email (captain confirmation).
// =============================================================================

const ALLOWED_ROLES = [USER_ROLES.CAPTAIN, USER_ROLES.SUPER_ADMIN] as const;

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/reassign' });

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
  const isAdmin = actorRole === USER_ROLES.SUPER_ADMIN;

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
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }
  const bodyParsed = reassignSchema.safeParse(bodyRaw);
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
  const { newExecUserId, reason } = bodyParsed.data;

  // 3. Load the request + current stage + city captain + current exec name.
  const oldExec = alias(users, 'old_exec');
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cityId: visitRequests.cityId,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
      statusStageCode: statusStages.code,
      statusStageSeq: statusStages.sequenceNumber,
      oldExecName: oldExec.fullName,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(oldExec, eq(oldExec.id, visitRequests.assignedExecUserId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json(
      { ok: false, error: 'Request not found' },
      { status: 404 },
    );
  }

  // 4. Cancelled gate.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      { ok: false, error: 'Request is closed. No further changes.' },
      { status: 409 },
    );
  }

  // 5. Terminal-stage gate.
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
        error: 'Cannot reassign on a completed request.',
      },
      { status: 409 },
    );
  }

  // 6. Must have a currently-assigned exec.
  if (reqRow.assignedExecUserId === null) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Request has no assigned exec yet. Use Assign instead of Reassign.',
      },
      { status: 409 },
    );
  }

  // 7. Per-row authorization. super_admin bypasses; captain must own
  //    the request's city.
  if (!isAdmin && reqRow.cityCaptainUserId !== actorUserId) {
    return NextResponse.json(
      { ok: false, error: 'This request is not in your assigned city.' },
      { status: 403 },
    );
  }

  // 8. No-op guard — the new target must be different from the current.
  if (newExecUserId === reqRow.assignedExecUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is already assigned to that exec.',
      },
      { status: 409 },
    );
  }

  // 9. Validate the target exec. Must:
  //    a) be a row in salesExecutives joined to users,
  //    b) users.is_active = true,
  //    c) salesExecutives.captain_user_id matches the city's captain
  //       (or actor if captain is acting; admin can bypass).
  const [execRow] = await db
    .select({
      userId: salesExecutives.userId,
      captainUserId: salesExecutives.captainUserId,
      fullName: users.fullName,
      isActive: users.isActive,
      role: users.role,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(eq(salesExecutives.userId, newExecUserId))
    .limit(1);

  if (!execRow) {
    return NextResponse.json(
      { ok: false, error: 'Target user is not a sales executive.' },
      { status: 400 },
    );
  }
  if (execRow.role !== USER_ROLES.SALES_EXECUTIVE) {
    return NextResponse.json(
      { ok: false, error: 'Target user is not a sales executive.' },
      { status: 400 },
    );
  }
  if (!execRow.isActive) {
    return NextResponse.json(
      { ok: false, error: 'Target exec is inactive.' },
      { status: 400 },
    );
  }
  // City-team gate: when captain is acting, target must be on their
  // own team. Admins can pull from any captain's team. We rely on
  // salesExecutives.captainUserId as the team link — the same pattern
  // HVA-81 /assign uses.
  const expectedTeamOwner = isAdmin
    ? reqRow.cityCaptainUserId
    : actorUserId;
  if (
    !isAdmin &&
    expectedTeamOwner !== null &&
    execRow.captainUserId !== expectedTeamOwner
  ) {
    return NextResponse.json(
      { ok: false, error: 'Target exec is not on your team.' },
      { status: 400 },
    );
  }

  const oldExecUserId = reqRow.assignedExecUserId;
  const oldExecName = reqRow.oldExecName ?? 'Previous exec';

  // 10. Atomic write: update visit_requests + insert the assignment row.
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(visitRequests)
        .set({
          assignedExecUserId: newExecUserId,
          updatedAt: new Date(),
        })
        .where(eq(visitRequests.id, requestUuid));
      await tx.insert(requestExecAssignments).values({
        requestId: requestUuid,
        fromExecUserId: oldExecUserId,
        toExecUserId: newExecUserId,
        captainUserId: actorUserId,
        reason,
      });
    });
  } catch (err) {
    reqLog.error(
      { requestUuid, err: err instanceof Error ? err.message : String(err) },
      'reassign_tx_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 11. Audit row.
  await logEvent({
    eventType: 'request_reassigned',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: {
      assignedExecUserId: oldExecUserId,
      assignedExecName: oldExecName,
    },
    afterState: {
      assignedExecUserId: newExecUserId,
      assignedExecName: execRow.fullName,
      cityName: reqRow.cityName,
    },
    reason,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 12. Notification dispatch — fire and forget. Engine resolves
  //     exec_removed → oldExecUserId, exec_assigned → execUserId,
  //     captain_acting → captainUserId. Email composer renders the
  //     captain confirmation; the two in-app composers render distinct
  //     bodies based on the recipientRole the engine injects into the
  //     context.
  const captainName =
    (session.user as { name?: string }).name ?? 'Captain';
  setImmediate(() => {
    dispatchNotification('request.reassigned', {
      requestId: requestUuid,
      customerName: reqRow.customerName,
      cityName: reqRow.cityName,
      oldExecUserId,
      oldExecName,
      newExecUserId,
      execUserId: newExecUserId, // exec_assigned resolver reads execUserId
      newExecName: execRow.fullName,
      captainUserId: actorUserId,
      captainName,
      reason,
    }).catch((err) => {
      reqLog.error(
        {
          requestUuid,
          err: err instanceof Error ? err.message : String(err),
        },
        'reassign_dispatch_failed',
      );
    });
  });

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      oldExec: { id: oldExecUserId, fullName: oldExecName },
      newExec: { id: newExecUserId, fullName: execRow.fullName },
    },
    { status: 200 },
  );
}
