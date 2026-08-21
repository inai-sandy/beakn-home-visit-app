// =============================================================================
// HVA-342: a customer deleting a product must not leave an exec waiting
// =============================================================================
//
// When a CartPlus edit removes a product from an order, HVA-280 soft-removes
// the line item so the quotation matches CartPlus. But an exec may already
// have asked support to dispatch that exact product.
//
// Leaving the request line alone would produce the worst kind of failure:
// support opens the request, tries to approve it, and the dispatch writer
// refuses (HVA-340) with an error about an item nobody asked them about —
// while the exec, who is chasing the customer, sees a request that still
// looks live.
//
// So the removal cancels the request line and tells the exec what happened.
// The row is kept, not deleted: the exec was waiting on this and is owed an
// explanation, not a row that quietly disappears.
//
// Fail-soft throughout — a webhook must not fail because a notification
// could not be composed. The line is cancelled inside one statement, so the
// data is correct even if the telling fails.
// =============================================================================

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  dispatchRequestItems,
  dispatchRequestOrders,
  dispatchRequests,
  quotationLineItems,
  visitRequests,
} from '@/db/schema';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';

export const CARTPLUS_REMOVAL_REASON =
  'Removed from the order in CartPlus by the customer';

/**
 * Cancel every open request line pointing at one of these line items.
 *
 * Only lines whose order group is still undecided (`pending` / `held`) on a
 * request that has not been withdrawn. An approved group is left alone — its
 * stock physically left before the customer's edit, and rewriting history to
 * say otherwise would put the dispatch record and the request at odds.
 *
 * Returns the number of request lines cancelled, for the caller's log line.
 */
export async function cancelRequestItemsForRemovedLineItems(
  lineItemIds: string[],
): Promise<number> {
  if (lineItemIds.length === 0) return 0;

  try {
    // Read the affected lines first: after the UPDATE the rows no longer
    // identify themselves as "just cancelled", and the notification needs
    // the customer and product names anyway.
    const affected = await db
      .select({
        itemId: dispatchRequestItems.id,
        quantity: dispatchRequestItems.quantity,
        productName: quotationLineItems.productName,
        dispatchRequestId: dispatchRequestOrders.dispatchRequestId,
        execUserId: dispatchRequests.execUserId,
        customerName: visitRequests.customerName,
      })
      .from(dispatchRequestItems)
      .innerJoin(
        dispatchRequestOrders,
        eq(dispatchRequestOrders.id, dispatchRequestItems.dispatchRequestOrderId),
      )
      .innerJoin(
        dispatchRequests,
        eq(dispatchRequests.id, dispatchRequestOrders.dispatchRequestId),
      )
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, dispatchRequestOrders.visitRequestId),
      )
      .innerJoin(
        quotationLineItems,
        eq(quotationLineItems.id, dispatchRequestItems.quotationLineItemId),
      )
      .where(
        and(
          inArray(dispatchRequestItems.quotationLineItemId, lineItemIds),
          isNull(dispatchRequestItems.cancelledAt),
          inArray(dispatchRequestOrders.status, ['pending', 'held']),
          ne(dispatchRequests.status, 'cancelled'),
        ),
      );

    if (affected.length === 0) return 0;

    await db
      .update(dispatchRequestItems)
      .set({
        cancelledAt: new Date(),
        cancelledReason: CARTPLUS_REMOVAL_REASON,
      })
      .where(
        inArray(
          dispatchRequestItems.id,
          affected.map((a) => a.itemId),
        ),
      );

    for (const row of affected) {
      void dispatchNotification('dispatch_request.item_cancelled', {
        dispatchRequestId: row.dispatchRequestId,
        dispatchRequestExecUserId: row.execUserId,
        customerName: row.customerName,
        productName: row.productName,
        quantity: row.quantity,
      }).catch((err: unknown) => {
        log.error(
          {
            err: err instanceof Error ? err.message : String(err),
            dispatchRequestItemId: row.itemId,
          },
          'dispatch_request_item_cancelled_notification_failed',
        );
      });
    }

    log.info(
      { count: affected.length, lineItemIds },
      'dispatch_request_items_cancelled_by_cartplus_removal',
    );
    return affected.length;
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), lineItemIds },
      'dispatch_request_item_cancellation_failed',
    );
    return 0;
  }
}
