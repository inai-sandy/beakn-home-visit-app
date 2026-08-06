import { logEvent } from '@/lib/audit';
// HVA-329: shared with the customer-cancel path — one definition of
// "how much stock is already out".
import { dispatchedQuantity } from '@/lib/dispatch/dispatched-quantity';
import { log } from '@/lib/logger';

import type { CancelNotificationContext } from './apply-status';

// =============================================================================
// HVA-326: announce a CartPlus cancellation to the internal teams
// =============================================================================
//
// Called by every CartPlus handler that can cancel a request, AFTER its
// transaction commits. Both cancel routes (`order.updated` carrying status
// `cancelled`, and the dedicated `order.cancelled` event) funnel through
// applyCartplusOrderStatus, so both arrive here with the same context and
// produce the same result — the drift that let a bare `order.cancelled`
// leave no timeline row and no cleared calendar is gone.
//
// Only the call that ACTUALLY cancelled gets a context, so the usual
// `order.updated` + `order.cancelled` pair (they arrive ~200ms apart, both
// saying cancelled) notifies exactly once.
//
// Fail-soft: a notification or audit failure must never turn into a 5xx that
// makes CartPlus retry a cancellation we have already applied.
// =============================================================================

export const CARTPLUS_CANCELLED_EVENT = 'request.cancelled_in_cartplus';
const AUDIT_EVENT = 'request_cancelled_in_cartplus';

const notifyLog = log.child({ component: 'webhooks.cartplus.notify_cancelled' });

/**
 * Notify exec + captain + support + super_admin, and write the audit row.
 *
 * No customer rule exists for this event by design: CartPlus has already
 * messaged the customer about the cancellation it performed.
 */
export async function notifyCartplusCancellation(
  ctx: CancelNotificationContext,
  orderNumber: string | null,
): Promise<void> {
  try {
    const dispatchedItemCount = await dispatchedQuantity(ctx.requestId);

    const { dispatchNotification } = await import('@/lib/notifications/engine');
    await dispatchNotification(CARTPLUS_CANCELLED_EVENT, {
      requestId: ctx.requestId,
      customerName: ctx.customerName,
      cityId: ctx.cityId,
      cityName: ctx.cityName,
      // Resolver keys — captain_owning_city reads cityCaptainUserId,
      // exec_assigned reads execUserId. Missing either is a skipped
      // delivery, not a failure.
      cityCaptainUserId: ctx.cityCaptainUserId,
      execUserId: ctx.execUserId,
      captainUserId: ctx.captainUserId,
      stageCode: ctx.stageCode,
      stageName: ctx.stageName,
      orderNumber,
      dispatchedItemCount,
    });

    await logEvent({
      eventType: AUDIT_EVENT,
      actorUserId: null,
      targetEntityType: 'visit_request',
      targetEntityId: ctx.requestId,
      beforeState: { stageCode: ctx.stageCode, cancelledAt: null },
      afterState: {
        stageCode: ctx.stageCode,
        cancelledAt: new Date().toISOString(),
        orderNumber,
        dispatchedItemCount,
      },
      reason: 'Cancelled in CartPlus',
    });

    notifyLog.info(
      {
        requestId: ctx.requestId,
        stageCode: ctx.stageCode,
        dispatchedItemCount,
      },
      'cartplus_cancellation_notified',
    );
  } catch (err) {
    notifyLog.warn(
      {
        requestId: ctx.requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      'cartplus_cancellation_notify_failed',
    );
  }
}
