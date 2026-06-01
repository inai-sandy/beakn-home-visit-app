import { desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities, requestStatusHistory, statusStages, visitRequests } from '@/db/schema';
import { dispatchNotification } from '@/lib/notifications/engine';
import { logEvent } from '@/lib/audit';
import { type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-67 + HVA-81: shared status-transition service
// =============================================================================
//
// Extracted from app/api/requests/[id]/status/route.ts during HVA-81 so the
// /assign route can run the forward-only validation + status update inside
// the same DB transaction as the assignment writes — without HTTP self-
// calling another route handler.
//
// CONTRACT:
//   transitionRequestStatus({requestId, nextStatusId, actorUserId,
//                            actorRole, reason?, ipAddress?, userAgent?,
//                            preUpdate?})
//     → { ok: true, previous, current }
//     → { ok: false, status, error, ... }
//
// preUpdate is an optional hook that runs INSIDE the transaction, BEFORE
// the status update. HVA-81 uses it to set assigned_exec_user_id +
// assigned_captain_user_id + assigned_at atomically with the
// Submitted→Assigned transition. Throws inside preUpdate roll back the
// whole transition.
//
// The audit log call happens AFTER the transaction commits — logEvent
// is a fire-and-forget contract (HVA-18, never throws), so it has its
// own connection and shouldn't be wrapped in the caller's tx.
// =============================================================================

export type StatusTransitionError =
  | { ok: false; status: 404; error: 'REQUEST_NOT_FOUND'; message: string }
  | { ok: false; status: 400; error: 'STAGE_NOT_FOUND'; message: string }
  | { ok: false; status: 400; error: 'STAGE_INACTIVE'; message: string }
  | { ok: false; status: 400; error: 'TERMINAL_STAGE'; message: string }
  | {
      ok: false;
      status: 400;
      error: 'FORWARD_ONLY';
      message: string;
      currentSequence: number;
      attemptedSequence: number;
    }
  | { ok: false; status: 503; error: 'TX_FAILED'; message: string };

export interface StageRef {
  id: string;
  name: string;
  sequenceNumber: number;
}

export interface StatusTransitionSuccess {
  ok: true;
  previous: StageRef;
  current: StageRef;
}

// drizzle's transaction callback receives a PgTransaction. Extract it from
// the db.transaction type so the public API stays a structural reference
// (no need to import the underlying type, which varies by driver).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TransitionInput {
  requestId: string;
  nextStatusId: string;
  actorUserId: string;
  actorRole: Role;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * Optional hook run INSIDE the transaction, BEFORE the status update.
   * Use for related writes that must commit atomically with the status
   * change — e.g. HVA-81 sets assigned_exec_user_id here so the
   * Submitted→Assigned transition is paired with the exec assignment
   * in a single tx.
   */
  preUpdate?: (tx: DbTx) => Promise<void>;
  /**
   * HVA-68: opt-in escape hatch from the strict +1 rule. When true, any
   * forward target stage is accepted (still `nextSeq > currentSeq`) —
   * skipping intermediate stages is allowed. Backward and same-stage
   * transitions are still rejected.
   *
   * Used by /api/requests/[id]/mark-installation-complete so an exec
   * standing at "Installation Scheduled" (seq 7) can jump directly to
   * "Pending Captain Approval" (seq 9), recording that intermediate
   * "Installation & Configuration Done" was implicitly completed by
   * the act of marking the whole installation done.
   *
   * Default `false` preserves the +1 invariant for every other caller
   * (the generic "Move to Next Stage" button + HVA-81 assign).
   */
  allowForwardSkip?: boolean;
  /**
   * HVA-141: opt-in to a SINGLE backward step (nextSeq === currentSeq - 1).
   * Used by /api/requests/[id]/rollback. Multi-stage rollback is not
   * supported — callers wanting more than one step back must invoke the
   * rollback route N times.
   *
   * Default `false` preserves the forward-only invariant for every
   * other caller.
   */
  allowRollback?: boolean;
  /**
   * HVA-137: narrow opt-in for a SPECIFIC named backward transition pair
   * (currentStageCode → nextStageCode). The validator accepts the
   * transition only when BOTH ends match exactly. Used by
   * /api/requests/[id]/reject to permit the multi-stage backward jump
   * PENDING_CAPTAIN_APPROVAL → INSTALLATION_SCHEDULED (seq 9 → 6) that
   * `allowRollback` (single step only) and `allowForwardSkip` (forward
   * only) cannot cover. Strictly narrower than a general "allow any
   * backward" footgun: every other arbitrary pair stays rejected.
   *
   * Default `undefined` preserves the forward-only invariant for every
   * other caller.
   */
  allowSpecificBackwardTransition?: { fromCode: string; toCode: string };
}

const transitionLog = log.child({ component: 'status-transition' });

export async function transitionRequestStatus(
  input: TransitionInput,
): Promise<StatusTransitionSuccess | StatusTransitionError> {
  const {
    requestId,
    nextStatusId,
    actorUserId,
    actorRole,
    reason,
    ipAddress,
    userAgent,
    preUpdate,
    allowForwardSkip = false,
    allowRollback = false,
    allowSpecificBackwardTransition,
  } = input;

  // 1. Load current request + its current stage (join). HVA-137 added
  //    currentStageCode so the validator can match the new
  //    `allowSpecificBackwardTransition` option's `fromCode`.
  const [currentRow] = await db
    .select({
      requestId: visitRequests.id,
      currentStageId: visitRequests.statusStageId,
      currentStageCode: statusStages.code,
      currentStageSeq: statusStages.sequenceNumber,
      currentStageName: statusStages.name,
      // 2026-05-30: customer + city + captain for the
      // request.pending_approval dispatch below.
      customerName: visitRequests.customerName,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      // HVA-46/47: customer phone + tracking token for WhatsApp template
      // dispatches on QUOTATION_SUBMITTED / ORDER_CONFIRMED /
      // INSTALLATION_COMPLETE transitions.
      customerPhone: visitRequests.customerPhone,
      trackingToken: visitRequests.trackingToken,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(visitRequests.id, requestId))
    .limit(1);

  if (!currentRow) {
    return {
      ok: false,
      status: 404,
      error: 'REQUEST_NOT_FOUND',
      message: 'Request not found',
    };
  }

  // 2. Load the proposed next stage.
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
    return {
      ok: false,
      status: 400,
      error: 'STAGE_NOT_FOUND',
      message: 'Target status stage not found',
    };
  }
  if (!nextRow.isActive) {
    return {
      ok: false,
      status: 400,
      error: 'STAGE_INACTIVE',
      message: 'Target status stage is inactive',
    };
  }

  // 3. Terminal check — dynamic MAX(sequence_number) on active stages.
  //    Admin-added stages extend the lifecycle without code changes.
  const [maxRow] = await db
    .select({ maxSeq: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);
  const maxSeq = maxRow?.maxSeq ?? 0;

  if (currentRow.currentStageSeq >= maxSeq) {
    return {
      ok: false,
      status: 400,
      error: 'TERMINAL_STAGE',
      message: `Already at the final stage (${currentRow.currentStageName}). Cannot transition further.`,
    };
  }

  // 4. Forward-only enforcement (with HVA-141 rollback exception).
  //    - Default: strict +1 (the immediate next stage only). Used by
  //      the generic "Move to Next Stage" button + HVA-81 assign.
  //    - allowForwardSkip=true: any strictly-forward target accepted
  //      (nextSeq > currentSeq). Backward and same-stage still rejected.
  //      Used by HVA-68 mark-installation-complete (seq 7 → 9 jump).
  //    - allowRollback=true: accept exactly nextSeq === currentSeq - 1.
  //      Multi-stage backward not allowed. Used by HVA-141 rollback.
  //    - allowSpecificBackwardTransition: accept exactly the named
  //      (fromCode, toCode) pair regardless of seq distance. Used by
  //      HVA-137 captain reject (PENDING_CAPTAIN_APPROVAL →
  //      INSTALLATION_SCHEDULED, a 3-stage backward jump). Any other
  //      pair is still rejected.
  const isStrictlyForward =
    nextRow.sequenceNumber > currentRow.currentStageSeq;
  const isExactlyNext =
    nextRow.sequenceNumber === currentRow.currentStageSeq + 1;
  const isExactlyPrev =
    allowRollback && nextRow.sequenceNumber === currentRow.currentStageSeq - 1;
  const isNamedBackwardPair =
    allowSpecificBackwardTransition !== undefined &&
    currentRow.currentStageCode === allowSpecificBackwardTransition.fromCode &&
    nextRow.code === allowSpecificBackwardTransition.toCode &&
    nextRow.sequenceNumber < currentRow.currentStageSeq;
  const forwardOk =
    isNamedBackwardPair ||
    isExactlyPrev ||
    (allowForwardSkip ? isStrictlyForward : isExactlyNext);
  if (!forwardOk) {
    return {
      ok: false,
      status: 400,
      error: 'FORWARD_ONLY',
      message: allowRollback
        ? `Cannot transition from sequence ${currentRow.currentStageSeq} to ${nextRow.sequenceNumber}. Rollback supports only a single backward step (currentSeq - 1).`
        : allowForwardSkip
          ? `Cannot transition from sequence ${currentRow.currentStageSeq} to ${nextRow.sequenceNumber}. Forward-only — target must be strictly after current.`
          : `Cannot transition from sequence ${currentRow.currentStageSeq} to ${nextRow.sequenceNumber}. Only the immediate next stage is allowed.`,
      currentSequence: currentRow.currentStageSeq,
      attemptedSequence: nextRow.sequenceNumber,
    };
  }

  // 5. Single transaction:
  //    a) preUpdate(tx) — caller-supplied atomic side-effect, if any
  //    b) UPDATE visit_requests.status_stage_id
  //    c) INSERT request_status_history (UNIQUE on
  //       (request_id, sequence_number) — guards against concurrent
  //       double-transitions to the same stage)
  try {
    await db.transaction(async (tx) => {
      if (preUpdate) await preUpdate(tx);

      await tx
        .update(visitRequests)
        .set({ statusStageId: nextRow.id, updatedAt: new Date() })
        .where(eq(visitRequests.id, requestId));

      // HVA-141: transition_order is monotonic per request. The
      // subquery runs inside the same tx so concurrent writers are
      // serialised by the UNIQUE (request_id, transition_order) index
      // — a racing INSERT would fail with a unique violation, which
      // we catch as TX_FAILED below. sequence_number still tracks the
      // target stage's seq for backward compatibility + human-readable
      // queries.
      await tx.insert(requestStatusHistory).values({
        requestId,
        fromStatusStageId: currentRow.currentStageId,
        toStatusStageId: nextRow.id,
        sequenceNumber: nextRow.sequenceNumber,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${requestId}), 0) + 1`,
        changedByUserId: actorUserId,
        reason: reason ?? null,
      });
    });
  } catch (err) {
    transitionLog.error(
      {
        requestId,
        nextStatusId,
        err: err instanceof Error ? err.message : String(err),
      },
      'status_transition_tx_failed',
    );
    return {
      ok: false,
      status: 503,
      error: 'TX_FAILED',
      message: 'Service temporarily unavailable.',
    };
  }

  // 6. Audit row. logEvent never throws (HVA-18 contract); runs outside
  //    the tx because it owns its own connection.
  await logEvent({
    eventType: 'status_change',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestId,
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
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  // 2026-05-30: fire request.pending_approval whenever the new stage is
  // PENDING_CAPTAIN_APPROVAL. Captain + admin care; exec is the actor so
  // doesn't need a self-ping. Fire-and-forget — never block the response.
  if (nextRow.code === 'PENDING_CAPTAIN_APPROVAL') {
    setImmediate(() => {
      dispatchNotification('request.pending_approval', {
        requestId,
        customerName: currentRow.customerName,
        cityName: currentRow.cityName,
        cityCaptainUserId: currentRow.cityCaptainUserId,
      }).catch((err) => {
        transitionLog.warn(
          { err: err instanceof Error ? err.message : String(err), requestId },
          'pending_approval_dispatch_failed',
        );
      });
    });
  }

  // HVA-47: customer-facing WhatsApp dispatches at the 3 emotional
  // stages — QUOTATION_SUBMITTED, ORDER_CONFIRMED, INSTALLATION_COMPLETE
  // / ORDER_EXECUTED_SUCCESSFULLY. Context carries customerPhone (the
  // `customer` recipient role's directAddress) + customerName +
  // trackingToken (for the template URL parameter). Fire-and-forget.
  const customerStageEventMap: Record<string, string> = {
    QUOTATION_SUBMITTED: 'request.quotation_submitted',
    ORDER_CONFIRMED: 'request.order_confirmed',
    INSTALLATION_COMPLETE: 'request.installation_complete',
    ORDER_EXECUTED_SUCCESSFULLY: 'request.installation_complete',
  };
  const customerEvent = customerStageEventMap[nextRow.code];
  if (customerEvent && currentRow.customerPhone && currentRow.trackingToken) {
    setImmediate(() => {
      dispatchNotification(customerEvent, {
        requestId,
        customerName: currentRow.customerName,
        customerPhone: currentRow.customerPhone,
        trackingToken: currentRow.trackingToken,
      }).catch((err) => {
        transitionLog.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            requestId,
            event: customerEvent,
          },
          'customer_whatsapp_dispatch_failed',
        );
      });
    });
  } else if (!customerStageEventMap[nextRow.code] && nextRow.code !== 'PENDING_CAPTAIN_APPROVAL') {
    transitionLog.info(
      {
        requestId,
        fromSeq: currentRow.currentStageSeq,
        toSeq: nextRow.sequenceNumber,
      },
      'status_transition_no_dispatch_for_this_target',
    );
  }

  return {
    ok: true,
    previous: {
      id: currentRow.currentStageId,
      name: currentRow.currentStageName,
      sequenceNumber: currentRow.currentStageSeq,
    },
    current: {
      id: nextRow.id,
      name: nextRow.name,
      sequenceNumber: nextRow.sequenceNumber,
    },
  };
}
