import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  quotationLineItems,
  quotations,
  visitRequests,
} from '@/db/schema';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-341: tell support when CartPlus confirms an order
// =============================================================================
//
// `support.order_ready_for_dispatch` was wired into the manual advance engine
// (lib/status-transition.ts) only. The webhook path reaches ORDER_CONFIRMED
// through applyCartplusOrderStatus, which never called it — so a request that
// CartPlus confirmed appeared in the dispatch queue with nobody told it was
// there.
//
// Production before this shipped: 8 CartPlus confirmations, 0 notifications.
// The three that did fire (2026-06-12, 08-03, 08-04) were all manual
// advances. It stayed invisible because roughly half of all confirmations
// were still being made by hand — and HVA-341 removes exactly that half.
//
// Called by BOTH handlers (order.created carrying status `confirmed`, and
// order.status_changed / order.updated flipping to it) so an order that
// arrives already-confirmed is indistinguishable from one confirmed two days
// later. One helper, because two copies of "what does support need to know"
// is how the manual and webhook paths drifted apart in the first place.
//
// Fail-soft, and called AFTER the transaction commits: a notification failure
// must never 5xx a webhook we have already applied, or CartPlus will retry a
// confirmation that already landed.
// =============================================================================

export const ORDER_READY_FOR_DISPATCH_EVENT = 'support.order_ready_for_dispatch';

const notifyLog = log.child({
  component: 'webhooks.cartplus.notify_order_confirmed',
});

/**
 * Announce a CartPlus-driven ORDER_CONFIRMED to the support team.
 *
 * Reads its own context rather than taking it from the caller: the count has
 * to be read after the line items are committed, and giving both handlers one
 * argument (the request id) is what stops them drifting.
 */
export async function notifyOrderReadyForDispatch(
  requestId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        customerName: visitRequests.customerName,
        cityName: cities.name,
      })
      .from(visitRequests)
      // LEFT join: a request with no city must still notify — support can
      // ship it, and a missing city is a data problem, not a reason to go
      // silent.
      .leftJoin(cities, eq(cities.id, visitRequests.cityId))
      .where(eq(visitRequests.id, requestId))
      .limit(1);

    if (!row) {
      notifyLog.warn({ requestId }, 'order_confirmed_request_missing');
      return;
    }

    // HVA-340: items a CartPlus edit removed are not work waiting for
    // support, so they must not inflate the count. Same rule the manual
    // advance applies.
    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(quotationLineItems)
      .innerJoin(
        quotations,
        eq(quotations.id, quotationLineItems.quotationId),
      )
      .where(
        and(
          eq(quotations.visitRequestId, requestId),
          isNull(quotationLineItems.removedAt),
        ),
      );
    const itemCount = countRow?.count ?? 0;

    const { dispatchNotification } = await import('@/lib/notifications/engine');
    await dispatchNotification(ORDER_READY_FOR_DISPATCH_EVENT, {
      requestId,
      customerName: row.customerName,
      cityName: row.cityName ?? 'Unknown city',
      itemCount,
    });

    notifyLog.info(
      { requestId, itemCount },
      'cartplus_order_confirmed_notified',
    );
  } catch (err) {
    notifyLog.warn(
      {
        requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      'cartplus_order_confirmed_notify_failed',
    );
  }
}
