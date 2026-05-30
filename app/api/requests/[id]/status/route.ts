import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { statusStages, visitRequests } from '@/db/schema';
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

  // HVA-68 + HVA-69: defensive stage / terminal-state gates.
  // - HVA-69: cancelled_at IS NOT NULL → request is terminal-rejected.
  //   Any actor (including super_admin) gets 409 — once rejected, no
  //   further forward transitions. A future "reopen" flow would explicitly
  //   un-set cancelled_at; that's not part of this ship.
  // - HVA-68: At PENDING_CAPTAIN_APPROVAL, sales_executive is blocked
  //   (waiting on captain approval). Captain + super_admin pass through.
  const [currentRow] = await db
    .select({
      code: statusStages.code,
      cancelledAt: visitRequests.cancelledAt,
      assignedExecUserId: visitRequests.assignedExecUserId,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  // HVA-135: per-row ownership check (defense-in-depth). proxy.ts gates
  // /api/* paths by role but can't enforce "this exec owns this request".
  // Without this guard, a sales_executive could POST to any request's
  // status route and drive its stage forward. Captain + super_admin
  // bypass — captain has team-scoped visibility (the assignment record
  // ties exec→captain, and stage rules already prevent cross-team writes)
  // and super_admin is global by design.
  if (
    actorRole === USER_ROLES.SALES_EXECUTIVE &&
    currentRow?.assignedExecUserId !== actorUserId
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden',
        message:
          'This request is not assigned to you. You can only update the status of requests assigned to you.',
      },
      { status: 403 },
    );
  }

  if (currentRow?.cancelledAt) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is terminal-rejected. No further status transitions.',
      },
      { status: 409 },
    );
  }
  // HVA-137: lock ALL transitions out of PENDING_CAPTAIN_APPROVAL behind
  // the dedicated /approve and /reject routes. Those routes carry the
  // captain-only auth gate AND the audit/notification fan-out the
  // generic status route doesn't. Exec hitting this would have been
  // blocked by the HVA-68 gate too; the WRONG_ROUTE error makes the
  // diagnosis explicit and now also catches captain/admin who must
  // use the dedicated routes.
  if (currentRow?.code === 'PENDING_CAPTAIN_APPROVAL') {
    return NextResponse.json(
      {
        ok: false,
        error: 'WRONG_ROUTE',
        message:
          'Use POST /api/requests/[id]/approve or /reject from this stage; the generic status route is disabled here.',
      },
      { status: 409 },
    );
  }

  // HVA-139: lock the SUBMITTED → ASSIGNED transition behind the
  // dedicated /api/requests/[id]/assign route. That route atomically
  // sets assigned_exec_user_id + assigned_captain_user_id + assigned_at
  // INSIDE the same tx as the stage advance; the generic status route
  // does not, so allowing this transition here would leave a request
  // at ASSIGNED with assigned_exec_user_id = NULL (the production bug
  // Arjun ran into on Preethi, 2026-05-17). Defence-in-depth: the UI
  // also hides the "Move to Assigned" button for captain/admin at
  // SUBMITTED via computeActionVisibility.
  if (currentRow?.code === 'SUBMITTED') {
    const [nextRow] = await db
      .select({ code: statusStages.code })
      .from(statusStages)
      .where(eq(statusStages.id, nextStatusId))
      .limit(1);
    if (nextRow?.code === 'ASSIGNED') {
      return NextResponse.json(
        {
          ok: false,
          error: 'WRONG_ROUTE',
          message:
            'Use POST /api/requests/[id]/assign to assign an exec; this route does not set assigned_exec_user_id.',
        },
        { status: 409 },
      );
    }
  }

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

  // HVA-143: invalidate the entire client Router Cache so the next
  // navigation to any sibling page (e.g. /captain/requests, /today)
  // serves fresh data. Layout-scope is intentional — server-side
  // caches aren't in use today (HVA-136 Phase 1 diagnostic), but the
  // Next streaming protocol still uses this signal to bust the client
  // cache on next nav.
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
