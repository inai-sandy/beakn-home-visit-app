import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  quotationLineItems,
  quotations,
  webhookEvents,
} from '@/db/schema';
import { log } from '@/lib/logger';

import type { CartplusEnvelope } from './envelope';
import { cartplusOrderEventDataSchema } from './order-payload';

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
      const [existing] = await tx
        .select({ id: quotations.id })
        .from(quotations)
        .where(eq(quotations.portalQuotationId, portalQuotationId))
        .limit(1);

      if (!existing) {
        return { matched: false };
      }

      // Refresh quotation header
      await tx
        .update(quotations)
        .set({
          quotationNumber: order.order_number,
          totalOrderValuePaise: Math.round(order.total_amount * 100),
          rawPayload: envelope as unknown as Record<string, unknown>,
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(quotations.id, existing.id));

      // Upsert line items by portal_line_item_id
      await upsertLineItems(tx, existing.id, order.items);

      return { matched: true, quotationId: existing.id };
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

    await markEvent(webhookEventId, 'ok', null);
    handlerLog.info(
      {
        webhookEventId,
        eventId: envelope.id,
        portalQuotationId,
        quotationId: result.quotationId,
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

async function upsertLineItems(
  tx: DbTx,
  quotationId: string,
  items: ReturnType<typeof cartplusOrderEventDataSchema.parse>['order']['items'],
): Promise<void> {
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
  // Note: we deliberately DO NOT delete line items that disappeared from
  // CartPlus. Quotations are append-only in HVA semantics (HVA-150 line);
  // a partial cancellation should come through as order.cancelled instead.
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

// Reference imports the linter would otherwise drop
void and;
