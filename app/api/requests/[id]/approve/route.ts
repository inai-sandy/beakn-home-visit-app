import { eq } from 'drizzle-orm';
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
import { approveSchema } from '@/lib/validators/approval';

// =============================================================================
// HVA-137: POST /api/requests/[id]/approve
// =============================================================================
//
// Captain (or super_admin) approves a request currently at
// PENDING_CAPTAIN_APPROVAL, advancing it to ORDER_EXECUTED_SUCCESSFULLY.
// Forward +1 transition (seq 9 → 10) — no special validator option needed.
//
// AUTH:
//   * captain — must own the request's city
//   * super_admin — bypasses the city gate
//   * sales_executive — 403 (cannot self-approve; captain owns the decision)
//
// STAGE GATE (409):
//   * current stage MUST equal PENDING_CAPTAIN_APPROVAL
//   * cancelled_at must be null
//
// WRITES:
//   * status_change audit row (from transition service)
//   * request_approved audit row (this route)
//
// NOTIFICATIONS:
//   * fire-and-forget setImmediate(dispatchNotification('request.approved'))
//     — in-app drawer to the assigned exec.
// =============================================================================

const ALLOWED_ROLES = [USER_ROLES.CAPTAIN, USER_ROLES.SUPER_ADMIN] as const;
const TARGET_STAGE_CODE = 'ORDER_EXECUTED_SUCCESSFULLY';

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/approve' });

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
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    throw err;
  }
  const actorUserId = session.user.id;
  const actorRole = (session.user as { role?: string }).role as Role;
  const captainName =
    (session.user as { name?: string }).name ?? 'A captain';
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

  let bodyRaw: unknown = {};
  if (req.headers.get('content-length') !== '0') {
    try {
      bodyRaw = await req.json();
    } catch {
      bodyRaw = {};
    }
  }
  const bodyParsed = approveSchema.safeParse(bodyRaw);
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
  const note = bodyParsed.data.note;

  // 3. Load request + city captain + assigned exec + current stage.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      assignedExecUserId: visitRequests.assignedExecUserId,
      execName: users.fullName,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
      statusStageCode: statusStages.code,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      { ok: false, error: 'Request is closed. No further changes.' },
      { status: 409 },
    );
  }
  if (reqRow.statusStageCode !== 'PENDING_CAPTAIN_APPROVAL') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Approve is only valid at Pending Captain Approval.',
        currentStage: reqRow.statusStageCode,
      },
      { status: 409 },
    );
  }

  // 4. Per-row authorization. super_admin bypasses; captain must own
  //    the request's city.
  if (!isAdmin && reqRow.cityCaptainUserId !== actorUserId) {
    return NextResponse.json(
      { ok: false, error: 'This request is not in your assigned city.' },
      { status: 403 },
    );
  }

  // 5. Look up target stage id.
  const [targetStage] = await db
    .select({ id: statusStages.id, name: statusStages.name })
    .from(statusStages)
    .where(eq(statusStages.code, TARGET_STAGE_CODE))
    .limit(1);
  if (!targetStage) {
    reqLog.error({}, 'order_executed_successfully_stage_not_seeded');
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 6. Forward transition. Pure +1 (seq 9 → 10) — no special option
  //    needed; transition service writes status_change + history rows.
  const result = await transitionRequestStatus({
    requestId: requestUuid,
    nextStatusId: targetStage.id,
    actorUserId,
    actorRole,
    reason: note,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, transitionError: result.error },
      'approve_transition_failed',
    );
    const { status, ...body } = result;
    return NextResponse.json(body, { status });
  }

  // 7. Action-named audit row carrying actor + optional note.
  await logEvent({
    eventType: 'request_approved',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: { statusStageCode: 'PENDING_CAPTAIN_APPROVAL' },
    afterState: {
      statusStageCode: TARGET_STAGE_CODE,
      note,
    },
    reason: note,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 8. Notify the assigned exec — in-app drawer. Fire-and-forget.
  if (reqRow.assignedExecUserId) {
    setImmediate(() => {
      dispatchNotification('request.approved', {
        requestId: requestUuid,
        customerName: reqRow.customerName,
        cityName: reqRow.cityName,
        captainUserId: actorUserId,
        captainName,
        execUserId: reqRow.assignedExecUserId,
        execName: reqRow.execName ?? 'Assigned executive',
        note,
      }).catch((err) => {
        reqLog.error(
          { requestUuid, err: err instanceof Error ? err.message : String(err) },
          'approve_dispatch_failed',
        );
      });
    });
  } else {
    reqLog.warn(
      { requestUuid },
      'approve_skipped_exec_dispatch_no_assigned_exec',
    );
  }

  // HVA-143: invalidate the client Router Cache so /captain/approvals,
  // /captain/requests, and the exec's /today reflect the terminal
  // state on the next navigation.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      previousStage: result.previous,
      currentStage: result.current,
    },
    { status: 200 },
  );
}
