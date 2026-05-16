import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { transitionRequestStatus } from '@/lib/status-transition';

// =============================================================================
// HVA-67: forward-only status transition endpoint
// =============================================================================
//
// POST /api/requests/[id]/status
//
// Thin HTTP wrapper around lib/status-transition.transitionRequestStatus.
// Extracted into a shared service during HVA-81 so the /assign route can
// run the forward-only validation + status update inside its own
// transaction (paired with the exec-assignment write).
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.CAPTAIN,
  USER_ROLES.SUPER_ADMIN,
] as const;
const apiLog = log.child({ route: '/api/requests/[id]/status' });

const bodySchema = z.object({
  nextStatusId: z.string().uuid('nextStatusId must be a valid UUID'),
  reason: z.string().trim().max(1000).optional(),
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
  const bodyParsed = bodySchema.safeParse(bodyRaw);
  if (!bodyParsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: bodyParsed.error.issues[0]?.message ?? 'Invalid body',
      },
      { status: 400 },
    );
  }
  const { nextStatusId, reason } = bodyParsed.data;

  const result = await transitionRequestStatus({
    requestId: requestUuid,
    nextStatusId,
    actorUserId,
    actorRole,
    reason,
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, nextStatusId, transitionError: result.error },
      'status_transition_rejected',
    );
    // Forward the service's response shape verbatim; the route doesn't
    // need to re-wrap or rewrite error codes.
    const { status, ...body } = result;
    return NextResponse.json(body, { status });
  }

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
