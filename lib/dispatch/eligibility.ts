// =============================================================================
// HVA-328: one definition of "this order can still be dispatched"
// =============================================================================
//
// Before this module the ORDER_CONFIRMED gate was written out four separate
// times — exported from lib/dispatch/fulfilment.ts and then re-declared as a
// local `const ORDER_CONFIRMED_SEQ = 6` in lib/support/dispatch-queries.ts,
// lib/support/orders-queries.ts and lib/support/filter-options.ts. Four copies
// of one rule, with nothing forcing them to agree.
//
// None of them considered cancellation. So a cancelled order kept every one of
// its unshipped line items in the support Pending queue with a live Dispatch
// button, its order page still read "Order Confirmed · 5 units remaining of 5",
// and the exec/captain dispatch views still showed the items as "Not shipped" —
// i.e. as work somebody still owed. Four production orders were sitting in that
// state, the oldest cancelled 50 days earlier.
//
// The split that matters:
//
//   dispatchable  — "should anyone be asked to ship this?"  Work queues only.
//                   Cancelled orders are NOT dispatchable and must not appear.
//
//   visible       — "should the dispatch record be shown at all?"  Record views
//                   (order detail, request detail). A cancelled order KEEPS its
//                   dispatch block, because when stock already went out that
//                   block is exactly what the manual recovery is worked from.
//
// Both are gated on the sequence number, never a hand-written list of stage
// codes — see the note on ORDER_CONFIRMED_SEQ in ./fulfilment.
// =============================================================================

import { gte, isNull, type SQL } from 'drizzle-orm';

import { statusStages, visitRequests } from '@/db/schema';

import { ORDER_CONFIRMED_SEQ } from './fulfilment';

export { ORDER_CONFIRMED_SEQ };

/**
 * The pure predicate. Anything holding a request's stage sequence and
 * cancellation timestamp can ask the question without touching the DB —
 * used by the addDispatch write guard, which has both to hand already.
 */
export interface DispatchEligibility {
  statusSequence: number;
  cancelledAt: Date | string | null;
}

export function isDispatchable(request: DispatchEligibility): boolean {
  return (
    request.statusSequence >= ORDER_CONFIRMED_SEQ && request.cancelledAt === null
  );
}

/**
 * The SQL half of the same rule, for every query that feeds a work queue:
 * the support Pending / In-progress queues and their summary tiles, the
 * sidebar counts, the filter dropdowns, and the centralized exec + captain
 * dispatch lists.
 *
 * Spread into an existing `conditions` array — these are the two conditions
 * that make a row dispatchable, nothing else.
 *
 * Deliberately NOT used by the Orders tab, the order detail page or the
 * request detail dispatch block. Those are records, not work queues; they
 * keep cancelled orders and mark them cancelled instead.
 */
export function dispatchableConditions(): SQL[] {
  return [
    gte(statusStages.sequenceNumber, ORDER_CONFIRMED_SEQ),
    isNull(visitRequests.cancelledAt),
  ];
}
