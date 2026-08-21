import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  quotationLineItems,
  quotations,
  webhookEvents,
} from '@/db/schema';
import { log } from '@/lib/logger';

import { applyCartplusOrderStatus } from './apply-status';
import { cancelRequestItemsForRemovedLineItems } from './cancel-request-items';
import type { CartplusEnvelope } from './envelope';
import { notifyCartplusCancellation } from './notify-cancelled';
import { notifyOrderReadyForDispatch } from './notify-order-confirmed';
import {
  diffOrder,
  notifyOrderChanged,
  orderChangeIsReportable,
  recordOrderChange,
  snapshotOrder,
  type OrderChangeContext,
} from './order-change';
import { cartplusBreakdownPaise, cartplusOrderEventDataSchema } from './order-payload';

// =============================================================================
// HVA-251 (HVA-230 Phase 2.B): handler for `order.status_changed`
// =============================================================================
//
// Portal sends this on every quotation revision (price changes, item
// add/remove, status flip). HVA-230 lock: HVA's status_stages does NOT
// auto-advance — the exec moves to ORDER_CONFIRMED manually. This handler
// only refreshes the quotation row + upserts line items.
//
// If no existing quotation matches the portal_quotation_id, we log + no-op.
// The order.created may have been lost or filtered out before we wired
// the receiver; manual cleanup can re-create from raw_payload if needed.
// =============================================================================

const handlerLog = log.child({ component: 'webhooks.cartplus.handler.status_changed' });

// drizzle's tx callback signature — same pattern as the create handler
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface HandlerOutcome {
  status: 'ok' | 'error' | 'skipped';
  reason?: string;
}

export async function handleCartplusOrderStatusChanged(
  envelope: CartplusEnvelope,
  webhookEventId: string,
): Promise<HandlerOutcome> {
  const parsed = cartplusOrderEventDataSchema.safeParse(envelope.data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}:${i.message}`)
      .join('; ');
    await markEvent(webhookEventId, 'error', issues);
    handlerLog.warn(
      { webhookEventId, eventId: envelope.id, issues },
      'order_payload_parse_failed',
    );
    return { status: 'error', reason: issues };
  }

  const order = parsed.data.order;
  const portalQuotationId = String(order.id);

  try {
    const result = await db.transaction(async (tx) => {
      // HVA-280 (H3): lock the quotation row for the duration of the tx so
      // two edits to the same CartPlus order can't interleave their header
      // + line-item updates. Concurrent edits now serialize by arrival.
      const [existing] = await tx
        .select({ id: quotations.id, requestId: quotations.visitRequestId })
        .from(quotations)
        .where(eq(quotations.portalQuotationId, portalQuotationId))
        .limit(1)
        .for('update');

      if (!existing) {
        return { matched: false };
      }

      // HVA-325: read the order as it stands BEFORE we overwrite it. Order
      // matters — snapshot after the update below and every "previous" value
      // is the one we just wrote, every diff is empty, and nobody is ever
      // told. The FOR UPDATE above is what makes this safe against the
      // concurrent edit HVA-280 hardened for.
      const before = await snapshotOrder(tx, existing.id);
      const reportable = await orderChangeIsReportable(tx, existing.requestId);

      // Refresh quotation header
      await tx
        .update(quotations)
        .set({
          quotationNumber: order.order_number,
          totalOrderValuePaise: Math.round(order.total_amount * 100),
          // HVA-296: refresh the money breakdown on every edit too.
          ...cartplusBreakdownPaise(order),
          rawPayload: envelope as unknown as Record<string, unknown>,
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, existing.id));

      // Upsert line items by portal_line_item_id. HVA-342: the ids this
      // removes are carried out of the transaction so open dispatch requests
      // pointing at them can be cancelled once the removal has committed.
      const removedLineItemIds = await upsertLineItems(
        tx,
        existing.id,
        order.items,
      );

      // HVA-285: map the CartPlus order status onto the Beakn stage —
      // pending → QUOTATION_GIVEN, confirmed → ORDER_CONFIRMED, cancelled →
      // cancel; forward-only, and a pending/confirmed un-cancels first.
      const statusResult = await applyCartplusOrderStatus(
        tx,
        existing.requestId,
        order.status,
        null,
      );

      // HVA-325: did anything material actually change, on a request that is
      // already at or past Order Confirmed? Both conditions have to hold —
      // below Order Confirmed an edit is ordinary quoting work, and a
      // cosmetic edit (name, SKU, notes) is not worth a notification.
      //
      // This also handles the duplicate delivery for free: CartPlus sends
      // `order.updated` and `order.status_changed` ~200ms apart for the same
      // edit, and by the time the second one runs the snapshot already
      // matches the payload, so the diff is empty and nothing fires.
      const diff = diffOrder(
        before,
        Math.round(order.total_amount * 100),
        order.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unitPricePaise: Math.round(item.unit_price * 100),
        })),
      );

      let orderChange: OrderChangeContext | null = null;
      if (diff.material && reportable?.reportable) {
        await recordOrderChange(tx, {
          requestId: existing.requestId,
          quotationId: existing.id,
          webhookEventId,
          stageCode: reportable.context.stageCode,
          diff,
        });
        orderChange = { ...reportable.context, diff };
      }

      return {
        matched: true,
        quotationId: existing.id,
        requestId: existing.requestId,
        statusResult,
        orderChange,
        removedLineItemIds,
      };
    });

    if (!result.matched) {
      handlerLog.warn(
        {
          webhookEventId,
          portalQuotationId,
          eventId: envelope.id,
        },
        'no_matching_quotation_skipping',
      );
      await markEvent(webhookEventId, 'ok', null);
      return { status: 'skipped', reason: 'no_matching_quotation' };
    }

    // HVA-326: a CartPlus edit whose status is `cancelled` cancels the
    // request through the same shared path as the dedicated
    // `order.cancelled` event. Announce it after the commit; the context is
    // present only on the call that actually performed the cancellation, so
    // the order.updated + order.cancelled pair notifies exactly once.
    if (result.statusResult?.cancelContext) {
      await notifyCartplusCancellation(
        result.statusResult.cancelContext,
        order.order_number,
      );
    }

    // HVA-341: CartPlus just confirmed this order, so it is now work waiting
    // for support. Announced after the commit — the dispatch queue must
    // already contain the row by the time the notification links to it.
    //
    // `advanced` is the guard that makes this idempotent: the duplicate
    // `order.updated` + `order.status_changed` pair CartPlus sends ~200ms
    // apart only advances the stage once, so support is told once.
    if (
      result.statusResult?.advanced &&
      result.statusResult.toStageCode === 'ORDER_CONFIRMED'
    ) {
      await notifyOrderReadyForDispatch(result.requestId);
    }

    // HVA-342: the customer deleted products an exec had already asked
    // support to dispatch. Cancel those request lines and tell the exec —
    // otherwise support hits the HVA-340 refusal on approval while the exec
    // is still chasing the customer about stock that is no longer ordered.
    //
    // After the commit, because the sweep reads the removal it is reacting
    // to. Fail-soft inside, so a webhook never fails over this.
    const removedLineItemIds = result.removedLineItemIds ?? [];
    if (removedLineItemIds.length > 0) {
      await cancelRequestItemsForRemovedLineItems(removedLineItemIds);
    }

    // HVA-325: the order changed under a confirmed request. Announced after
    // the commit so we never report a change a rollback would undo.
    if (result.orderChange) {
      await notifyOrderChanged(result.orderChange, order.order_number);
    }

    await markEvent(webhookEventId, 'ok', null);
    handlerLog.info(
      {
        webhookEventId,
        eventId: envelope.id,
        portalQuotationId,
        quotationId: result.quotationId,
        statusResult: result.statusResult,
      },
      'order_status_changed_handled',
    );
    return { status: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEvent(webhookEventId, 'error', message.slice(0, 1000));
    handlerLog.error(
      { webhookEventId, eventId: envelope.id, err: message },
      'order_status_changed_handler_failed',
    );
    return { status: 'error', reason: message };
  }
}

/**
 * Returns the ids of line items this edit REMOVED from the order (HVA-342),
 * so the caller can cancel dispatch requests that were waiting on them once
 * the transaction has committed.
 */
async function upsertLineItems(
  tx: DbTx,
  quotationId: string,
  items: ReturnType<typeof cartplusOrderEventDataSchema.parse>['order']['items'],
): Promise<string[]> {
  // Pull existing rows for this quotation to decide insert vs update.
  const existing = await tx
    .select({
      id: quotationLineItems.id,
      portalLineItemId: quotationLineItems.portalLineItemId,
      position: quotationLineItems.position,
    })
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, quotationId));

  const byPortalId = new Map<number, { id: string; position: number }>();
  let maxPosition = 0;
  for (const row of existing) {
    if (row.portalLineItemId !== null) {
      byPortalId.set(row.portalLineItemId, { id: row.id, position: row.position });
    }
    if (row.position > maxPosition) maxPosition = row.position;
  }

  for (const item of items) {
    const match = byPortalId.get(item.id);
    if (match) {
      await tx
        .update(quotationLineItems)
        .set({
          productName: item.name,
          productSku: item.sku,
          quantity: item.quantity,
          unitPricePaise: Math.round(item.unit_price * 100),
          lineTotalPaise: Math.round(item.line_total * 100),
          notes: item.notes ?? null,
          portalProductId: item.product_id,
          // HVA-280 (H1): a re-added item un-removes itself.
          removedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(quotationLineItems.id, match.id));
    } else {
      maxPosition += 1;
      await tx.insert(quotationLineItems).values({
        quotationId,
        position: maxPosition,
        productName: item.name,
        productSku: item.sku,
        quantity: item.quantity,
        unitPricePaise: Math.round(item.unit_price * 100),
        lineTotalPaise: Math.round(item.line_total * 100),
        notes: item.notes ?? null,
        portalProductId: item.product_id,
        portalLineItemId: item.id,
      });
    }
  }

  // HVA-280 (H1): items the customer REMOVED from the CartPlus order are
  // no longer in the payload — soft-remove them (no-deletes rule) so the
  // live quotation matches CartPlus exactly. A later re-add clears the
  // flag in the update branch above. Hard delete would break dispatch FK
  // references, so we mark instead.
  const incomingPortalIds = new Set(items.map((i) => i.id));
  const toRemoveIds = existing
    .filter(
      (row) =>
        row.portalLineItemId !== null &&
        !incomingPortalIds.has(row.portalLineItemId),
    )
    .map((row) => row.id);
  if (toRemoveIds.length > 0) {
    await tx
      .update(quotationLineItems)
      .set({ removedAt: new Date(), updatedAt: new Date() })
      .where(inArray(quotationLineItems.id, toRemoveIds));
  }

  return toRemoveIds;
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
