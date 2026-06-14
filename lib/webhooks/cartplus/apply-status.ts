import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requestStatusHistory, statusStages, visitRequests } from '@/db/schema';

import {
  PORTAL_CANCEL_REASON,
  PORTAL_CANCEL_REASON_CODE,
} from './handler-order-cancelled';

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

export interface ApplyStatusResult {
  /** Status stage advanced forward. */
  advanced: boolean;
  /** Request was cancelled and got un-cancelled. */
  reactivated: boolean;
  /** Request was cancelled by a CartPlus 'cancelled' status. */
  cancelled: boolean;
  /** Target Beakn stage code, when one applied. */
  toStageCode?: string;
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
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
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
    return { ...NOOP, cancelled: true };
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

  return { advanced, reactivated, cancelled: false, toStageCode: targetCode };
}
