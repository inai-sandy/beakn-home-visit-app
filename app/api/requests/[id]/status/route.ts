import { desc, eq } from 'drizzle-orm';
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
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-67: forward-only status transition (backend only — no UI in this issue)
// =============================================================================
//
// POST /api/requests/[id]/status
//
// Auth: must be authenticated as sales_executive / captain / super_admin.
// The proxy default-denies the /api/requests/ prefix (it's not in
// NO_AUTH_PREFIXES), so the redirect-on-anonymous path is handled at the
// proxy. This route additionally uses requireAuth() so 401/403 responses
// from inside the API don't depend on the proxy being correctly configured.
//
// Body (Zod-validated):
//   { nextStatusId: uuid, reason?: string }
//
// Forward-only rule (spec §3.4):
//   - Loads visit_requests row by id, joins status_stages to get the
//     current sequence_number.
//   - Loads the proposed next status_stage by id (uuid).
//   - Rejects with 400 { error: "FORWARD_ONLY" } if
//     nextStage.sequence_number !== currentStage.sequence_number + 1.
//   - Rejects with 400 { error: "TERMINAL_STAGE" } if the current stage
//     is the highest sequence_number on file (today: 10, "Order Executed
//     Successfully"). The "is this terminal?" check is dynamic — compares
//     against MAX(sequence_number) on every call so admin-added stages
//     extend the lifecycle without code changes.
//
// On success (single DB transaction):
//   - UPDATE visit_requests.status_stage_id = nextStatusId
//   - INSERT request_status_history row with from_status_stage_id =
//     current, to_status_stage_id = next, sequence_number = next.seq
//     (the schema's UNIQUE (request_id, sequence_number) constraint
//     means duplicate inserts for the same target stage would conflict).
//   - logEvent({ eventType: 'status_change', ... }) — already in the
//     audit_enabled_events allow-list from HVA-17/HVA-18 defaults.
//
// NOT IN THIS ISSUE:
//   - UI (button on /captain/dashboard or /today). Deferred until staff
//     dashboards exist (HVA-?).
//   - Notification event dispatch. TODO comment in source for HVA-48/49.
//   - "Mark Installation Complete" — that's HVA-68.
//   - Backward / skip / admin-override paths.
// =============================================================================

const ALLOWED_ROLES = ['sales_executive', 'captain', 'super_admin'] as const;
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

  // 1. Auth + role gate. requireAuth throws UnauthorizedError (no session)
  //    or ForbiddenError (wrong role); both map to the standard HTTP codes.
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
  const actorRole = (session.user as { role?: string }).role as
    | 'sales_executive'
    | 'captain'
    | 'super_admin';

  // 2. Validate path param + JSON body.
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

  // 3. Load the visit_request + its current stage (LEFT JOIN to surface
  //    a 404 cleanly if the id doesn't exist).
  const [currentRow] = await db
    .select({
      requestId: visitRequests.id,
      currentStageId: visitRequests.statusStageId,
      currentStageSeq: statusStages.sequenceNumber,
      currentStageName: statusStages.name,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!currentRow) {
    return NextResponse.json(
      { ok: false, error: 'Request not found' },
      { status: 404 },
    );
  }

  // 4. Load the proposed next stage.
  const [nextRow] = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
      isActive: statusStages.isActive,
    })
    .from(statusStages)
    .where(eq(statusStages.id, nextStatusId))
    .limit(1);

  if (!nextRow) {
    return NextResponse.json(
      { ok: false, error: 'Target status stage not found' },
      { status: 400 },
    );
  }
  if (!nextRow.isActive) {
    return NextResponse.json(
      { ok: false, error: 'Target status stage is inactive' },
      { status: 400 },
    );
  }

  // 5. Forward-only enforcement.
  //    - Terminal check: is the CURRENT stage already at MAX(sequence_number)?
  //      Computed dynamically so admin-added stages extend the lifecycle.
  const [{ maxSeq }] = await db
    .select({ maxSeq: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);

  if (currentRow.currentStageSeq >= maxSeq) {
    return NextResponse.json(
      {
        ok: false,
        error: 'TERMINAL_STAGE',
        message: `Already at the final stage (${currentRow.currentStageName}). Cannot transition further.`,
      },
      { status: 400 },
    );
  }

  //    - Strict +1 rule: skip and backward both rejected with the same
  //      error code so the client can render a single "forward-only"
  //      explanation. Caller is expected to know which stage is "next"
  //      from the visit_requests row's join to status_stages.
  if (nextRow.sequenceNumber !== currentRow.currentStageSeq + 1) {
    return NextResponse.json(
      {
        ok: false,
        error: 'FORWARD_ONLY',
        message: `Cannot transition from sequence ${currentRow.currentStageSeq} to ${nextRow.sequenceNumber}. Only the immediate next stage is allowed.`,
        currentSequence: currentRow.currentStageSeq,
        attemptedSequence: nextRow.sequenceNumber,
      },
      { status: 400 },
    );
  }

  // 6. Apply transition in a single transaction:
  //    - Update visit_requests.status_stage_id
  //    - Insert request_status_history row with the schema-required
  //      sequence_number column (per-request transition counter, UNIQUE
  //      with request_id — concurrent double-transitions to the same
  //      stage will conflict at the DB layer).
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(visitRequests)
        .set({ statusStageId: nextRow.id, updatedAt: new Date() })
        .where(eq(visitRequests.id, requestUuid));

      await tx.insert(requestStatusHistory).values({
        requestId: requestUuid,
        fromStatusStageId: currentRow.currentStageId,
        toStatusStageId: nextRow.id,
        sequenceNumber: nextRow.sequenceNumber,
        changedByUserId: actorUserId,
        reason: reason ?? null,
      });
    });
  } catch (err) {
    reqLog.error(
      {
        requestUuid,
        nextStatusId,
        err: err instanceof Error ? err.message : String(err),
      },
      'status_transition_tx_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 7. Audit. eventType 'status_change' is already in the
  //    audit_enabled_events default allow-list (HVA-17 seed).
  await logEvent({
    eventType: 'status_change',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: {
      statusStageId: currentRow.currentStageId,
      sequenceNumber: currentRow.currentStageSeq,
      stageName: currentRow.currentStageName,
    },
    afterState: {
      statusStageId: nextRow.id,
      sequenceNumber: nextRow.sequenceNumber,
      stageName: nextRow.name,
    },
    reason: reason ?? null,
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 8. Notification engine STUB. HVA-48/HVA-49 replace this with the real
  //    dispatch. TODO(HVA-48/HVA-49): fire('request.status_changed', {
  //    requestId: requestUuid, fromStage: currentRow.currentStageName,
  //    toStage: nextRow.name, actorUserId })
  reqLog.info(
    {
      requestUuid,
      fromSeq: currentRow.currentStageSeq,
      toSeq: nextRow.sequenceNumber,
      notificationEngine: 'pending_HVA-48',
    },
    'status_transition_notification_pending',
  );

  return NextResponse.json(
    {
      ok: true,
      requestId: requestUuid,
      previousStage: {
        id: currentRow.currentStageId,
        name: currentRow.currentStageName,
        sequenceNumber: currentRow.currentStageSeq,
      },
      currentStage: {
        id: nextRow.id,
        name: nextRow.name,
        sequenceNumber: nextRow.sequenceNumber,
      },
    },
    { status: 200 },
  );
}
