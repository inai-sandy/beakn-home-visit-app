import { sql } from 'drizzle-orm';

import { visitRequests } from '@/db/schema';

// =============================================================================
// HVA-305: order-level dispatch aggregate for the exec + captain lists
// =============================================================================
//
// Four correlated subqueries keyed on visit_requests.id, meant to be added
// to the SELECT of an already-paginated rows query. At 10 rows (exec) and
// 25 (captain) that is cheap, and it keeps the aggregate out of the
// bucket-count pass — which HVA-153 D6 deliberately runs separately, and
// which must not change.
//
// Defined once here rather than inline in each page so the exec list, the
// captain list and (later) any report agree on what "shipped" counts as.
// The support side has its own CTE-shaped version in
// lib/support/orders-queries.ts because it filters and sorts on these
// values; this one only reads them.
//
// Relationship chain, same as everywhere else in dispatch:
//   visit_requests → quotations → quotation_line_items → dispatch_items
//                                                      → dispatches
// =============================================================================

/** Units the customer ordered across every line item on the order. */
export const ORDER_UNITS_TOTAL_SQL = sql<number>`COALESCE((
  SELECT SUM(qli.quantity)
  FROM quotation_line_items qli
  JOIN quotations q ON q.id = qli.quotation_id
  WHERE q.visit_request_id = ${visitRequests.id}
), 0)::int`;

/** Units that have actually gone out, summed across every installment. */
export const ORDER_UNITS_SHIPPED_SQL = sql<number>`COALESCE((
  SELECT SUM(di.qty_in_this_dispatch)
  FROM dispatch_items di
  JOIN quotation_line_items qli ON qli.id = di.quotation_line_item_id
  JOIN quotations q ON q.id = qli.quotation_id
  WHERE q.visit_request_id = ${visitRequests.id}
), 0)::int`;

/** How many separate packages this order has been split into. */
export const ORDER_SHIPMENT_COUNT_SQL = sql<number>`COALESCE((
  SELECT COUNT(DISTINCT di.dispatch_id)
  FROM dispatch_items di
  JOIN quotation_line_items qli ON qli.id = di.quotation_line_item_id
  JOIN quotations q ON q.id = qli.quotation_id
  WHERE q.visit_request_id = ${visitRequests.id}
), 0)::int`;

/**
 * Shipments whose LATEST stage is 'delivered'.
 *
 * Latest-stage-per-dispatch, not "has a delivered row" — dispatch_status_
 * history is append-only with UNIQUE(dispatch_id, stage), so reading the
 * most recent row is the only correct way to ask what state a shipment is
 * actually in.
 */
export const ORDER_DELIVERED_SHIPMENT_COUNT_SQL = sql<number>`COALESCE((
  SELECT COUNT(*)
  FROM (
    SELECT DISTINCT di.dispatch_id
    FROM dispatch_items di
    JOIN quotation_line_items qli ON qli.id = di.quotation_line_item_id
    JOIN quotations q ON q.id = qli.quotation_id
    WHERE q.visit_request_id = ${visitRequests.id}
  ) d
  JOIN LATERAL (
    SELECT stage
    FROM dispatch_status_history
    WHERE dispatch_id = d.dispatch_id
    ORDER BY changed_at DESC
    LIMIT 1
  ) latest ON TRUE
  WHERE latest.stage = 'delivered'
), 0)::int`;

/** Spread into a Drizzle `.select({...})` to pull all four at once. */
export const orderDispatchSummarySelect = {
  dispatchUnitsTotal: ORDER_UNITS_TOTAL_SQL,
  dispatchUnitsShipped: ORDER_UNITS_SHIPPED_SQL,
  dispatchShipmentCount: ORDER_SHIPMENT_COUNT_SQL,
  dispatchDeliveredShipmentCount: ORDER_DELIVERED_SHIPMENT_COUNT_SQL,
} as const;

export interface RawOrderDispatchCounts {
  dispatchUnitsTotal: number;
  dispatchUnitsShipped: number;
  dispatchShipmentCount: number;
  dispatchDeliveredShipmentCount: number;
}
