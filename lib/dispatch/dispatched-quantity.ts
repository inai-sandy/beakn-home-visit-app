// =============================================================================
// HVA-329: "how much of this order is already out?" — one implementation
// =============================================================================
//
// Written for the CartPlus cancellation in HVA-326 and private to that module.
// The customer-cancel path needs the identical number for the identical
// reason, so it moves here rather than being copied — a second copy would let
// the two cancellation doors disagree about how much stock is stranded, which
// is the one number in the message that costs real money to get wrong.
// =============================================================================

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { dispatchItems, quotationLineItems, quotations } from '@/db/schema';
import { log } from '@/lib/logger';

const qtyLog = log.child({ component: 'dispatch.dispatched_quantity' });

/**
 * Total quantity already handed to a courier for this request's order.
 *
 * Counts EVERY dispatch row — including ones against line items a later
 * CartPlus edit soft-removed. Filtering those out would hide exactly the
 * stock most likely to be stranded.
 *
 * Fail-soft by design: a lookup failure returns 0 rather than throwing,
 * because "cancelled" reaching the team matters more than the dispatch
 * figure being present. Callers are notification paths, not ledgers.
 */
export async function dispatchedQuantity(requestId: string): Promise<number> {
  try {
    const [row] = await db
      .select({
        qty: sql<number>`COALESCE(SUM(${dispatchItems.qtyInThisDispatch}), 0)::int`,
      })
      .from(dispatchItems)
      .innerJoin(
        quotationLineItems,
        eq(quotationLineItems.id, dispatchItems.quotationLineItemId),
      )
      .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
      .where(eq(quotations.visitRequestId, requestId));
    return Number(row?.qty ?? 0);
  } catch (err) {
    qtyLog.warn(
      { requestId, err: err instanceof Error ? err.message : String(err) },
      'dispatched_quantity_lookup_failed',
    );
    return 0;
  }
}
