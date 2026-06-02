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
import { getConfig } from '@/lib/config';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { transitionRequestStatus } from '@/lib/status-transition';
import { rejectSchema } from '@/lib/validators/approval';

// =============================================================================
// HVA-137: POST /api/requests/[id]/reject
// =============================================================================
//
// Captain (or super_admin) sends the request back from
// PENDING_CAPTAIN_APPROVAL to INSTALLATION_SCHEDULED (seq 9 → 6, a
// 3-stage backward jump). Permitted only via this route — the validator
// gates the pair behind `allowSpecificBackwardTransition`.
//
// Reason is MANDATORY (50–500 chars) — the assigned exec needs to know
// what to fix before re-advancing.
// =============================================================================

const ALLOWED_ROLES = [USER_ROLES.CAPTAIN, USER_ROLES.SUPER_ADMIN] as const;
const FROM_STAGE_CODE = 'PENDING_CAPTAIN_APPROVAL';
const TARGET_STAGE_CODE = 'INSTALLATION_SCHEDULED';

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/reject' });

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

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const bodyParsed = rejectSchema.safeParse(bodyRaw);
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

  // 3. Load request + current stage + city captain + assigned exec.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      trackingToken: visitRequests.trackingToken,
      whatsappOptIn: visitRequests.whatsappOptIn,
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
  if (reqRow.statusStageCode !== FROM_STAGE_CODE) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Reject is only valid at Pending Captain Approval.',
        currentStage: reqRow.statusStageCode,
      },
      { status: 409 },
    );
  }

  if (!isAdmin && reqRow.cityCaptainUserId !== actorUserId) {
    return NextResponse.json(
      { ok: false, error: 'This request is not in your assigned city.' },
      { status: 403 },
    );
  }

  // 4. Look up target stage id (INSTALLATION_SCHEDULED).
  const [targetStage] = await db
    .select({ id: statusStages.id, name: statusStages.name })
    .from(statusStages)
    .where(eq(statusStages.code, TARGET_STAGE_CODE))
    .limit(1);
  if (!targetStage) {
    reqLog.error({}, 'installation_scheduled_stage_not_seeded');
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 5. Run the backward transition with the named-pair option. The
  //    validator accepts only this exact pair; any other current/target
  //    code combo with this option set is rejected as FORWARD_ONLY.
  const result = await transitionRequestStatus({
    requestId: requestUuid,
    nextStatusId: targetStage.id,
    actorUserId,
    actorRole,
    reason,
    allowSpecificBackwardTransition: {
      fromCode: FROM_STAGE_CODE,
      toCode: TARGET_STAGE_CODE,
    },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, transitionError: result.error },
      'reject_transition_failed',
    );
    const { status, ...body } = result;
    return NextResponse.json(body, { status });
  }

  // 6. Action-named audit row.
  await logEvent({
    eventType: 'request_rejected_by_captain',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: { statusStageCode: FROM_STAGE_CODE },
    afterState: { statusStageCode: TARGET_STAGE_CODE, reason },
    reason,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 7. Notify the assigned exec + customer — fire and forget.
  // HVA-47: customer dispatch must fire even when no exec is assigned
  // (the customer still needs the apology + support phone). The engine
  // resolves recipients per rule, so it silently skips exec_assigned
  // when execUserId is null.
  // HVA-47: we_had_to_cancel template needs the support phone in {{2}}.
  // Read it here (before setImmediate) so a slow DB doesn't delay the
  // 200; getConfig is one tiny SELECT.
  const supportPhone = await getConfig('customer_support_phone').catch(
    () => '',
  );
  setImmediate(() => {
    dispatchNotification('request.rejected', {
      requestId: requestUuid,
      customerName: reqRow.customerName,
      // HVA-47: customer-facing WhatsApp inputs.
      customerPhone: reqRow.customerPhone,
      trackingToken: reqRow.trackingToken,
      // HVA-79: opt-in gate.
      customerWhatsappOptIn: reqRow.whatsappOptIn,
      supportPhone,
      cityName: reqRow.cityName,
      captainUserId: actorUserId,
      captainName,
      execUserId: reqRow.assignedExecUserId,
      execName: reqRow.execName ?? 'Assigned executive',
      reason,
    }).catch((err) => {
      reqLog.error(
        { requestUuid, err: err instanceof Error ? err.message : String(err) },
        'reject_dispatch_failed',
      );
    });
  });

  // HVA-143: invalidate the client Router Cache so the captain's
  // approvals queue empties and the exec's pages refresh with the
  // backward transition reflected.
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
