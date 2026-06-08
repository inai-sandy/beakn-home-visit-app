import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  quotations,
  visitRequests,
  webhookEvents,
} from '@/db/schema';
import { log } from '@/lib/logger';

import type { CartplusEnvelope } from './envelope';
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
// =============================================================================

const handlerLog = log.child({ component: 'webhooks.cartplus.handler.cancelled' });

export const PORTAL_CANCEL_REASON_CODE = 'portal_cancelled';
export const PORTAL_CANCEL_REASON = 'Cancelled in CartPlus portal';

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
      const [quote] = await tx
        .select({
          id: quotations.id,
          visitRequestId: quotations.visitRequestId,
        })
        .from(quotations)
        .where(eq(quotations.portalQuotationId, portalQuotationId))
        .limit(1);
      if (!quote) {
        return { matched: false };
      }

      const [request] = await tx
        .select({
          id: visitRequests.id,
          cancelledAt: visitRequests.cancelledAt,
        })
        .from(visitRequests)
        .where(eq(visitRequests.id, quote.visitRequestId))
        .limit(1);

      if (!request) {
        // FK should make this impossible but be defensive
        return { matched: false };
      }
      if (request.cancelledAt) {
        return { matched: true, alreadyCancelled: true, requestId: request.id };
      }

      const now = new Date();
      await tx
        .update(visitRequests)
        .set({
          cancelledAt: now,
          cancellationActor: 'customer',
          cancellationReason: PORTAL_CANCEL_REASON,
          cancellationReasonCode: PORTAL_CANCEL_REASON_CODE,
          updatedAt: now,
        })
        .where(eq(visitRequests.id, request.id));

      // Refresh raw_payload on the quotation so the audit trail has the
      // final cancellation snapshot.
      await tx
        .update(quotations)
        .set({
          rawPayload: envelope as unknown as Record<string, unknown>,
          lastWebhookAt: now,
          updatedAt: now,
        })
        .where(eq(quotations.id, quote.id));

      return { matched: true, alreadyCancelled: false, requestId: request.id };
    });

    if (!result.matched) {
      handlerLog.warn(
        { webhookEventId, portalQuotationId, eventId: envelope.id },
        'no_matching_quotation_skipping',
      );
      await markEvent(webhookEventId, 'ok', null);
      return { status: 'skipped', reason: 'no_matching_quotation' };
    }
    if (result.alreadyCancelled) {
      handlerLog.info(
        { webhookEventId, requestId: result.requestId },
        'already_cancelled_noop',
      );
      await markEvent(webhookEventId, 'ok', null);
      return { status: 'ok', requestId: result.requestId };
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
