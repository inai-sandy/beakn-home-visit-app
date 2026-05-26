import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { approveRequest } from '@/lib/captain/approve-request';
import { log } from '@/lib/logger';
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

  // 3. Delegate to shared helper — same logic the bulk action uses.
  const result = await approveRequest({
    requestId: requestUuid,
    actor: { userId: actorUserId, role: actorRole, name: captainName },
    note,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, code: result.code },
      'approve_helper_rejected',
    );
    const status =
      result.code === 'NOT_FOUND'
        ? 404
        : result.code === 'CANCELLED' || result.code === 'WRONG_STAGE'
          ? 409
          : result.code === 'NOT_OWNER'
            ? 403
            : result.code === 'STAGE_NOT_SEEDED'
              ? 503
              : result.code === 'TRANSITION_FAILED'
                ? result.status
                : 500;
    return NextResponse.json(
      result.code === 'WRONG_STAGE'
        ? { ok: false, error: result.message, currentStage: result.currentStage }
        : { ok: false, error: result.message },
      { status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      previousStage: result.previousStage,
      currentStage: result.currentStage,
    },
    { status: 200 },
  );
}
