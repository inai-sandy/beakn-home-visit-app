import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { quotations, webhookEvents } from '@/db/schema';
import { log } from '@/lib/logger';

import { applyCartplusOrderStatus } from './apply-status';
import type { CartplusEnvelope } from './envelope';
import { notifyCartplusCancellation } from './notify-cancelled';
import { cartplusOrderEventDataSchema } from './order-payload';

// =============================================================================
// HVA-251 (HVA-230 Phase 2.B): handler for `order.cancelled`
// =============================================================================
//
// Marks the existing visit_request as cancelled. We DO NOT advance the
// status_stage to a "cancelled" stage — visit_requests tracks cancellation
// via dedicated columns (cancelled_at / cancellation_actor / reason).
//
// Idempotent: if the request is already cancelled, no-op.
//
// If no matching quotation exists (we missed the create), skip + log.
//
// -----------------------------------------------------------------------------
// HVA-326: this handler no longer writes the cancellation itself
// -----------------------------------------------------------------------------
//
// It used to: set cancelled_at, refresh the payload, done. The OTHER cancel
// route — an `order.updated` carrying status `cancelled`, which runs through
// applyCartplusOrderStatus — did strictly more. It also wrote a status
// history row and cleared the linked visit/installation appointment.
//
// In practice CartPlus sends both, `order.updated` first, so the fuller path
// usually ran and this one found the request already cancelled and no-opped.
// But the pairing is not guaranteed: on 2026-06-14 01:48:54 a bare
// `order.cancelled` arrived for CP-20260613-IJJOST with no `order.updated`
// before it, and that request got the thin treatment — no timeline entry, no
// calendar cleanup.
//
// One rule with two implementations is the bug. This handler now delegates,
// so there is only one implementation and both routes are equivalent by
// construction rather than by luck of arrival order.
// =============================================================================

const handlerLog = log.child({ component: 'webhooks.cartplus.handler.cancelled' });

// Re-exported from their new home. The constants moved to cancel-reason.ts
// because apply-status.ts needs them too, and importing them from this file
// once this file imports apply-status would be a cycle.
export {
  PORTAL_CANCEL_REASON,
  PORTAL_CANCEL_REASON_CODE,
} from './cancel-reason';

export interface HandlerOutcome {
  status: 'ok' | 'error' | 'skipped';
  reason?: string;
  requestId?: string;
}

export async function handleCartplusOrderCancelled(
  envelope: CartplusEnvelope,
  webhookEventId: string,
): Promise<HandlerOutcome> {
  const parsed = cartplusOrderEventDataSchema.safeParse(envelope.data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}:${i.message}`)
      .join('; ');
    await markEvent(webhookEventId, 'error', issues);
    return { status: 'error', reason: issues };
  }

  const order = parsed.data.order;
  const portalQuotationId = String(order.id);

  try {
    const result = await db.transaction(async (tx) => {
      // HVA-280 (H3): lock the quotation row so a cancellation can't race
      // a concurrent status_changed edit of the same order.
      const [quote] = await tx
        .select({
          id: quotations.id,
          visitRequestId: quotations.visitRequestId,
        })
        .from(quotations)
        .where(eq(quotations.portalQuotationId, portalQuotationId))
        .limit(1)
        .for('update');
      if (!quote) {
        return { matched: false as const };
      }

      // HVA-326: the single cancel implementation. Sets cancelled_at with
      // the portal reason, writes the history row, clears the linked
      // visit/installation task. Idempotent — a request already cancelled
      // comes back with `cancelled: false` and no context, which is what
      // keeps the usual order.updated + order.cancelled pair to ONE
      // notification.
      const statusResult = await applyCartplusOrderStatus(
        tx,
        quote.visitRequestId,
        'cancelled',
        null,
      );

      // Refresh raw_payload on the quotation so the audit trail has the
      // final cancellation snapshot.
      const now = new Date();
      await tx
        .update(quotations)
        .set({
          rawPayload: envelope as unknown as Record<string, unknown>,
          lastWebhookAt: now,
          updatedAt: now,
        })
        .where(eq(quotations.id, quote.id));

      return {
        matched: true as const,
        requestId: quote.visitRequestId,
        statusResult,
      };
    });

    if (!result.matched) {
      handlerLog.warn(
        { webhookEventId, portalQuotationId, eventId: envelope.id },
        'no_matching_quotation_skipping',
      );
      await markEvent(webhookEventId, 'ok', null);
      return { status: 'skipped', reason: 'no_matching_quotation' };
    }

    if (!result.statusResult.cancelled) {
      handlerLog.info(
        { webhookEventId, requestId: result.requestId },
        'already_cancelled_noop',
      );
      await markEvent(webhookEventId, 'ok', null);
      return { status: 'ok', requestId: result.requestId };
    }

    // Post-commit: announcing from inside the transaction would tell the
    // team about a cancellation a rollback could still undo.
    if (result.statusResult.cancelContext) {
      await notifyCartplusCancellation(
        result.statusResult.cancelContext,
        order.order_number,
      );
    }

    await markEvent(webhookEventId, 'ok', null);
    handlerLog.info(
      {
        webhookEventId,
        eventId: envelope.id,
        portalQuotationId,
        requestId: result.requestId,
      },
      'order_cancelled_handled',
    );
    return { status: 'ok', requestId: result.requestId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEvent(webhookEventId, 'error', message.slice(0, 1000));
    handlerLog.error(
      { webhookEventId, eventId: envelope.id, err: message },
      'order_cancelled_handler_failed',
    );
    return { status: 'error', reason: message };
  }
}

async function markEvent(
  id: string,
  result: 'ok' | 'noop' | 'error',
  errorMessage: string | null,
): Promise<void> {
  try {
    await db
      .update(webhookEvents)
      .set({ result, errorMessage, processedAt: new Date() })
      .where(eq(webhookEvents.id, id));
  } catch {
    // best-effort
  }
}
