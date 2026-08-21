import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { cancelLinkedVisitTask } from '@/lib/visit-schedule/task-sync';

import {
  PORTAL_CANCEL_REASON,
  PORTAL_CANCEL_REASON_CODE,
} from './cancel-reason';

// =============================================================================
// HVA-285: map a CartPlus order status onto a Beakn request stage
// =============================================================================
//
// Sandeep 2026-06-14: CartPlus drives exactly three order statuses; Beakn
// owns everything after Order Confirmed.
//
//   pending   → QUOTATION_GIVEN   (the default portal state)
//   confirmed → ORDER_CONFIRMED   (records a history row → /track + Booked)
//   cancelled → cancel the request
//
// Rules:
//   * Forward-only: advance only when the request's current stage seq is
//     BELOW the target; never move backward; no-op if already at/past it.
//   * A pending/confirmed status arriving on a previously-cancelled
//     request REACTIVATES it (clears cancelled_at) before applying the
//     stage — CartPlus updating an order means it's live again.
//   * Unknown statuses are ignored.
//
// Used inside the webhook handlers' transaction (created + updated/
// status_changed), AFTER the quotation has been written/refreshed.
// =============================================================================

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const STATUS_TO_STAGE_CODE: Record<string, string> = {
  pending: 'QUOTATION_GIVEN',
  confirmed: 'ORDER_CONFIRMED',
};

const CANCEL_STATUSES = new Set(['cancelled', 'canceled']);

/** The one advance worth announcing — see `confirmContext`. */
const CONFIRMED_STAGE_CODE = 'ORDER_CONFIRMED';

/**
 * HVA-326: everything the `request.cancelled_in_cartplus` notification needs,
 * captured inside the transaction that performs the cancel.
 *
 * Read here rather than by the caller because the stage is what the request
 * was at *when CartPlus cancelled it* — one query later it is still the same
 * row, but the intent ("the stage we cancelled out of") is only unambiguous
 * at this point.
 *
 * Present ONLY when this call actually performed the cancellation. An
 * already-cancelled request returns `cancelled: false` and no context, which
 * is what stops the `order.updated` + `order.cancelled` pair from notifying
 * twice.
 */
export interface RequestNotificationTargets {
  requestId: string;
  customerName: string;
  cityId: string | null;
  cityName: string | null;
  cityCaptainUserId: string | null;
  execUserId: string | null;
  captainUserId: string | null;
}

export interface CancelNotificationContext extends RequestNotificationTargets {
  /** Stage the request had reached when CartPlus cancelled it. */
  stageCode: string;
  stageName: string;
}

export interface ApplyStatusResult {
  /** Status stage advanced forward. */
  advanced: boolean;
  /** Request was cancelled and got un-cancelled. */
  reactivated: boolean;
  /** Request was cancelled by a CartPlus 'cancelled' status. */
  cancelled: boolean;
  /** Target Beakn stage code, when one applied. */
  toStageCode?: string;
  /**
   * HVA-345: set ONLY on the call that actually advanced the request to
   * ORDER_CONFIRMED. CartPlus is the sole source of order confirmation since
   * HVA-341, and this path told nobody — the exec and captain learned that
   * their order was confirmed by opening the app and noticing.
   *
   * Gated on `advanced` for the same reason the cancel context is gated on
   * performing the cancel: CartPlus sends `order.updated` and
   * `order.status_changed` ~200ms apart for one change, and the second finds
   * the request already at ORDER_CONFIRMED. Forward-only advance means only
   * the first call reports, so the pair announces once.
   */
  confirmContext?: RequestNotificationTargets;
  /**
   * Set only on the call that performed the cancellation. The caller
   * dispatches the notification AFTER the transaction commits — notifying
   * from inside would announce a cancellation that a later rollback undoes.
   */
  cancelContext?: CancelNotificationContext;
}

const NOOP: ApplyStatusResult = {
  advanced: false,
  reactivated: false,
  cancelled: false,
};

export async function applyCartplusOrderStatus(
  tx: DbTx,
  requestId: string,
  orderStatus: string | null | undefined,
  actorUserId: string | null,
): Promise<ApplyStatusResult> {
  const status = (orderStatus ?? '').toLowerCase();

  const [req] = await tx
    .select({
      cancelledAt: visitRequests.cancelledAt,
      currentStageId: visitRequests.statusStageId,
      currentSeq: statusStages.sequenceNumber,
      // HVA-326: notification context, read in the same round-trip.
      currentStageCode: statusStages.code,
      currentStageName: statusStages.name,
      customerName: visitRequests.customerName,
      cityId: visitRequests.cityId,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      execUserId: visitRequests.assignedExecUserId,
      captainUserId: visitRequests.assignedCaptainUserId,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    // LEFT join: a request whose city row is missing must still cancel.
    .leftJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(visitRequests.id, requestId))
    .limit(1);
  if (!req) return NOOP;

  const now = new Date();

  // ---- cancelled ----
  if (CANCEL_STATUSES.has(status)) {
    if (req.cancelledAt) return { ...NOOP }; // already cancelled — idempotent
    await tx
      .update(visitRequests)
      .set({
        cancelledAt: now,
        cancellationActor: 'customer',
        cancellationReason: PORTAL_CANCEL_REASON,
        cancellationReasonCode: PORTAL_CANCEL_REASON_CODE,
        updatedAt: now,
      })
      .where(eq(visitRequests.id, requestId));
    // Timeline parity with the customer/staff cancel paths: write a history
    // row (same "CANCELLED_BY_CUSTOMER:" prefix) so /track shows it and
    // history-based cancellation reports count it — previously omitted.
    const [ord] = await tx
      .select({
        maxOrder: sql<number>`COALESCE(MAX(${requestStatusHistory.transitionOrder}), 0)`,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    await tx.insert(requestStatusHistory).values({
      requestId,
      fromStatusStageId: req.currentStageId,
      toStatusStageId: req.currentStageId,
      sequenceNumber: req.currentSeq,
      transitionOrder: Number(ord?.maxOrder ?? 0) + 1,
      changedByUserId: actorUserId,
      reason: `CANCELLED_BY_CUSTOMER: ${PORTAL_CANCEL_REASON}`,
    });
    // Clear the linked visit task so the exec's calendar/day plan updates.
    // VISIT_TYPES is APPOINTMENT_TASK_TYPES, so this clears the
    // "Installation & Activation" appointment too, not just visit tasks —
    // which is the case Sandeep cares about most (a cancel landing after
    // the captain has blocked out an installation day).
    await cancelLinkedVisitTask(tx, requestId);
    return {
      ...NOOP,
      cancelled: true,
      cancelContext: {
        requestId,
        customerName: req.customerName,
        cityId: req.cityId,
        cityName: req.cityName,
        cityCaptainUserId: req.cityCaptainUserId,
        execUserId: req.execUserId,
        captainUserId: req.captainUserId,
        stageCode: req.currentStageCode,
        stageName: req.currentStageName,
      },
    };
  }

  // ---- pending / confirmed ----
  const targetCode = STATUS_TO_STAGE_CODE[status];
  if (!targetCode) return NOOP; // unknown status — ignore

  const [target] = await tx
    .select({ id: statusStages.id, seq: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.code, targetCode))
    .limit(1);
  if (!target) return NOOP;

  // Reactivate a cancelled request — CartPlus is updating it, so it's live.
  let reactivated = false;
  if (req.cancelledAt) {
    await tx
      .update(visitRequests)
      .set({
        cancelledAt: null,
        cancellationActor: null,
        cancellationReason: null,
        cancellationReasonCode: null,
        updatedAt: now,
      })
      .where(eq(visitRequests.id, requestId));
    reactivated = true;
  }

  // Forward-only stage advance.
  let advanced = false;
  if (req.currentSeq < target.seq) {
    const [orderRow] = await tx
      .select({
        maxOrder: sql<number>`COALESCE(MAX(${requestStatusHistory.transitionOrder}), 0)`,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    await tx.insert(requestStatusHistory).values({
      requestId,
      fromStatusStageId: req.currentStageId,
      toStatusStageId: target.id,
      sequenceNumber: target.seq,
      transitionOrder: Number(orderRow?.maxOrder ?? 0) + 1,
      changedByUserId: actorUserId,
      reason: `CartPlus status: ${status}`,
      changedAt: now,
    });
    await tx
      .update(visitRequests)
      .set({ statusStageId: target.id, updatedAt: now })
      .where(eq(visitRequests.id, requestId));
    advanced = true;
  }

  return {
    advanced,
    reactivated,
    cancelled: false,
    toStageCode: targetCode,
    confirmContext:
      advanced && targetCode === CONFIRMED_STAGE_CODE
        ? {
            requestId,
            customerName: req.customerName,
            cityId: req.cityId,
            cityName: req.cityName,
            cityCaptainUserId: req.cityCaptainUserId,
            execUserId: req.execUserId,
            captainUserId: req.captainUserId,
          }
        : undefined,
  };
}
