import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { cities, statusStages, users, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { transitionRequestStatus } from '@/lib/status-transition';

// =============================================================================
// 2026-05-26: factored approve-request helper
// =============================================================================
//
// The existing /api/requests/[id]/approve route did all the per-request
// work inline. PR9 bulk-approve needs to invoke the same flow N times
// for one captain action, and HTTP self-calls from a server action are
// the wrong pattern. Pull the per-request steps into a single helper
// both call sites can reuse.
//
// Inputs assume the caller has already done the role gate (captain or
// super_admin). City ownership is rechecked per-request because in the
// bulk path, the captain may have selected rows that drift between
// page-render and submit.
//
// Errors come back as a discriminated union with a stable `code` so the
// bulk caller can collect per-row failures + the singular route can
// return matching HTTP status codes.
// =============================================================================

export type ApproveRequestError =
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | { ok: false; code: 'CANCELLED'; message: string }
  | { ok: false; code: 'WRONG_STAGE'; message: string; currentStage: string }
  | { ok: false; code: 'NOT_OWNER'; message: string }
  | { ok: false; code: 'STAGE_NOT_SEEDED'; message: string }
  | { ok: false; code: 'TRANSITION_FAILED'; message: string; status: number };

export interface ApproveRequestSuccess {
  ok: true;
  requestId: string;
  customerName: string;
  previousStage: { id: string; name: string; sequenceNumber: number };
  currentStage: { id: string; name: string; sequenceNumber: number };
}

export interface ApproveRequestInput {
  requestId: string;
  actor: {
    userId: string;
    role: Role;
    /** Display name for the notification dispatch. */
    name?: string;
  };
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const TARGET_STAGE_CODE = 'ORDER_EXECUTED_SUCCESSFULLY';

const helperLog = log.child({ component: 'approve-request' });

export async function approveRequest(
  input: ApproveRequestInput,
): Promise<ApproveRequestSuccess | ApproveRequestError> {
  const { requestId, actor, note, ipAddress, userAgent } = input;
  const isAdmin = actor.role === USER_ROLES.SUPER_ADMIN;

  // 1. Load request + city captain + assigned exec + current stage.
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
    .where(eq(visitRequests.id, requestId))
    .limit(1);

  if (!reqRow) {
    return { ok: false, code: 'NOT_FOUND', message: 'Request not found' };
  }
  if (reqRow.cancelledAt !== null) {
    return {
      ok: false,
      code: 'CANCELLED',
      message: 'Request is closed. No further changes.',
    };
  }
  if (reqRow.statusStageCode !== 'PENDING_CAPTAIN_APPROVAL') {
    return {
      ok: false,
      code: 'WRONG_STAGE',
      message: 'Approve is only valid at Pending Captain Approval.',
      currentStage: reqRow.statusStageCode,
    };
  }
  if (!isAdmin && reqRow.cityCaptainUserId !== actor.userId) {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: 'This request is not in your assigned city.',
    };
  }

  // 2. Resolve target stage id.
  const [targetStage] = await db
    .select({ id: statusStages.id, name: statusStages.name })
    .from(statusStages)
    .where(eq(statusStages.code, TARGET_STAGE_CODE))
    .limit(1);
  if (!targetStage) {
    helperLog.error({}, 'order_executed_successfully_stage_not_seeded');
    return {
      ok: false,
      code: 'STAGE_NOT_SEEDED',
      message: 'Service temporarily unavailable.',
    };
  }

  // 3. Forward transition (writes status_change + history).
  const result = await transitionRequestStatus({
    requestId,
    nextStatusId: targetStage.id,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason: note ?? null,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });
  if (!result.ok) {
    helperLog.info(
      { requestId, transitionError: result.error },
      'approve_transition_failed',
    );
    return {
      ok: false,
      code: 'TRANSITION_FAILED',
      message: result.message,
      status: result.status,
    };
  }

  // 4. Action-named audit row.
  await logEvent({
    eventType: 'request_approved',
    actorUserId: actor.userId,
    actorRole: actor.role,
    targetEntityType: 'visit_request',
    targetEntityId: requestId,
    beforeState: { statusStageCode: 'PENDING_CAPTAIN_APPROVAL' },
    afterState: { statusStageCode: TARGET_STAGE_CODE, note: note ?? null },
    reason: note ?? null,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  // 5. Fire-and-forget notification to the assigned exec.
  if (reqRow.assignedExecUserId) {
    setImmediate(() => {
      dispatchNotification('request.approved', {
        requestId,
        customerName: reqRow.customerName,
        cityName: reqRow.cityName,
        captainUserId: actor.userId,
        captainName: actor.name ?? 'A captain',
        execUserId: reqRow.assignedExecUserId,
        execName: reqRow.execName ?? 'Assigned executive',
        note: note ?? undefined,
      }).catch((err) => {
        helperLog.error(
          { requestId, err: err instanceof Error ? err.message : String(err) },
          'approve_dispatch_failed',
        );
      });
    });
  }

  // 6. Cache invalidation. Bulk callers call this N times — the
  // revalidatePath calls are idempotent so duplicate calls don't hurt;
  // tagging would be a future optimisation.
  revalidatePath('/', 'layout');

  return {
    ok: true,
    requestId,
    customerName: reqRow.customerName,
    previousStage: result.previous,
    currentStage: result.current,
  };
}
