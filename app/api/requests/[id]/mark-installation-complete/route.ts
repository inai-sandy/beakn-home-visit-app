import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { statusStages, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { transitionRequestStatus } from '@/lib/status-transition';
import { markInstallationCompleteSchema } from '@/lib/validators/mark-installation-complete';

// =============================================================================
// HVA-68: POST /api/requests/[id]/mark-installation-complete
// =============================================================================
//
// Special-cased forward transition: exec (or super_admin escape hatch)
// moves a request to PENDING_CAPTAIN_APPROVAL.
//
// AUTH:
//   - sales_executive (must be the assigned exec) OR super_admin (bypasses
//     the assigned-exec gate for support).
//   - Captain → 403 (this is an exec action; HVA-80 ships the captain's
//     Approve/Reject from there).
//
// CURRENT-STAGE GATE:
//   - Only valid from INSTALLATION_SCHEDULED (seq 7) or
//     INSTALLATION_CONFIGURATION_DONE (seq 8). Any other current stage
//     returns 409.
//
// TRANSITION:
//   - Target is always PENDING_CAPTAIN_APPROVAL (seq 9).
//   - From seq 8 this is strict +1. From seq 7 this skips seq 8 — handled
//     via the HVA-68-introduced `allowForwardSkip` flag on the transition
//     service. Forward-only still enforced (no backward / same-stage).
//
// NOTE STORAGE:
//   - Optional free-text note → `request_status_history.reason` (handled
//     by the transition service via the `reason` input parameter) AND
//     echoed into audit_log.after_state for redundancy + admin queryability.
//
// NOTIFICATION:
//   - HVA-48/49 will replace the TODO log line below with the captain
//     in-app + email fan-out. Out of scope for HVA-68.
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.SUPER_ADMIN,
] as const;
const VALID_FROM_STAGES = [
  'INSTALLATION_SCHEDULED',
  'INSTALLATION_CONFIGURATION_DONE',
] as const;
const TARGET_STAGE_CODE = 'PENDING_CAPTAIN_APPROVAL';

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/mark-installation-complete' });

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
  // Body is optional (note may be omitted). Tolerate empty body.
  if (req.headers.get('content-length') !== '0') {
    try {
      bodyRaw = await req.json();
    } catch {
      // Empty/malformed body — treat as no note.
      bodyRaw = {};
    }
  }
  const bodyParsed = markInstallationCompleteSchema.safeParse(bodyRaw);
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

  // 3. Load the request + its current stage + terminal flag.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cancelledAt: visitRequests.cancelledAt,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }

  // HVA-69: a terminal-rejected request cannot be marked complete.
  // Matches the page-level button-hide; defends against direct curl.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Request is terminal-rejected. Cannot mark installation complete.',
      },
      { status: 409 },
    );
  }

  // 4. Per-request authorization. super_admin bypasses; otherwise the
  //    actor must be the assigned exec on this specific request.
  if (!isAdmin && reqRow.assignedExecUserId !== actorUserId) {
    return NextResponse.json(
      { ok: false, error: 'You are not the assigned executive for this request.' },
      { status: 403 },
    );
  }

  // 5. Current-stage gate.
  if (
    !(VALID_FROM_STAGES as readonly string[]).includes(reqRow.statusStageCode)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot mark installation complete from "${reqRow.statusStageName}". This action is only valid from Installation Scheduled or Installation & Configuration Done.`,
        currentStage: reqRow.statusStageCode,
      },
      { status: 409 },
    );
  }

  // 6. Look up the target stage id (PENDING_CAPTAIN_APPROVAL).
  const [targetStage] = await db
    .select({ id: statusStages.id, name: statusStages.name })
    .from(statusStages)
    .where(eq(statusStages.code, TARGET_STAGE_CODE))
    .limit(1);
  if (!targetStage) {
    reqLog.error({}, 'pending_captain_approval_stage_not_seeded');
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 7. Run the transition. allowForwardSkip=true so a seq 7 → 9 jump
  //    works (still forward-only). reason flows to request_status_history.
  const result = await transitionRequestStatus({
    requestId: requestUuid,
    nextStatusId: targetStage.id,
    actorUserId,
    actorRole,
    reason: note ?? null,
    allowForwardSkip: true,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    reqLog.info(
      { requestUuid, transitionError: result.error },
      'mark_installation_complete_transition_failed',
    );
    const { status, ...body } = result;
    return NextResponse.json(body, { status });
  }

  // 8. Audit row. The transition service already wrote a 'status_change'
  //    row; this is the action-named row carrying the note in afterState
  //    so admin/captain dashboards can surface "exec marked it complete
  //    with the following note" cleanly.
  await logEvent({
    eventType: 'installation_marked_complete',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: { statusStageCode: reqRow.statusStageCode },
    afterState: {
      statusStageCode: TARGET_STAGE_CODE,
      note: note ?? null,
    },
    reason: note ?? null,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 9. Notification engine — STUB. HVA-48/49 will replace this with the
  //    captain in-app + email fan-out ("Your team has marked X complete —
  //    please review and approve/reject").
  reqLog.info(
    {
      requestUuid,
      previousStage: reqRow.statusStageCode,
      currentStage: TARGET_STAGE_CODE,
      notificationEngine: 'pending_HVA-48',
    },
    'installation_marked_complete_notification_pending',
  );

  // HVA-143: client Router Cache invalidation so the captain's
  // /captain/approvals lists this new pending row on next nav.
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
