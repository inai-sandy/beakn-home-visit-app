// =============================================================================
// HVA-302: shared fulfilment derivations (per-product shipped vs pending)
// =============================================================================
//
// Orders ship in installments, so "is this order shipped" is never a
// single boolean — it's per line item, derived from quantity maths:
//
//   quantityTotal      — what the customer ordered
//   quantityDispatched — SUM(dispatch_items.qty_in_this_dispatch)
//   quantityRemaining  — the difference
//
// The SQL that produces those three numbers already exists
// (`DISPATCHED_QTY_SQL` in lib/support/order-detail.ts). This module owns
// the *interpretation* of them so support, exec and captain can never
// disagree about what "shipped" means. Pure functions only — no DB, no
// React — so they're cheap to unit test and safe to import anywhere.
// =============================================================================

/**
 * Orders become dispatchable at ORDER_CONFIRMED, sequence 6. Mirrors the
 * `ORDER_CONFIRMED_SEQ = 6` guard the support side already uses in
 * addDispatchAction and lib/support/*.
 *
 * Gate on the SEQUENCE, never on a hand-written list of stage codes. The
 * original HVA-243 gate listed 'INSTALLATION_DONE', which is not a real
 * stage code — the actual stages above INSTALLATION_SCHEDULED are
 * INSTALLATION_CONFIGURATION_DONE (8) and PENDING_CAPTAIN_APPROVAL (9),
 * so dispatch state silently vanished from the order detail at those two
 * stages and reappeared at ORDER_EXECUTED_SUCCESSFULLY (10). A sequence
 * comparison can't rot that way when a stage is added or renamed.
 */
export const ORDER_CONFIRMED_SEQ = 6;

export function isDispatchVisible(statusSequence: number): boolean {
  return statusSequence >= ORDER_CONFIRMED_SEQ;
}

export interface FulfilmentItem {
  id: string;
  productName: string;
  productSku: string | null;
  quantityTotal: number;
  quantityDispatched: number;
  quantityRemaining: number;
  unitPricePaise: number;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
}

/** Per-product fulfilment state. Deliberately three-valued: a partially
 *  shipped product is the common case here, not an edge case. */
export type ItemFulfilmentState = 'pending' | 'partial' | 'complete';

export const ITEM_STATE_LABEL: Record<ItemFulfilmentState, string> = {
  pending: 'Not shipped',
  partial: 'Partly shipped',
  complete: 'Shipped',
};

export const ITEM_STATE_TONE: Record<ItemFulfilmentState, string> = {
  pending: 'border-muted-foreground/30 text-muted-foreground bg-muted/40',
  partial: 'border-amber-500/30 text-amber-700 bg-amber-500/10',
  complete: 'border-emerald-500/30 text-emerald-700 bg-emerald-500/10',
};

/**
 * Classify one line item.
 *
 * Reads `quantityDispatched` rather than `quantityRemaining` for the
 * pending check: a data glitch that over-dispatches (remaining < 0)
 * should still read as shipped, not silently fall back to "not shipped".
 */
export function itemFulfilmentState(
  item: Pick<FulfilmentItem, 'quantityTotal' | 'quantityDispatched'>,
): ItemFulfilmentState {
  if (item.quantityDispatched <= 0) return 'pending';
  if (item.quantityDispatched >= item.quantityTotal) return 'complete';
  return 'partial';
}

export interface FulfilmentSummary {
  unitsTotal: number;
  unitsShipped: number;
  unitsPending: number;
  productsTotal: number;
  productsComplete: number;
  productsPending: number;
  /** Order-level roll-up of the per-item states. */
  state: ItemFulfilmentState;
}

/**
 * Roll a line-item list up to an order-level summary.
 *
 * The order is only `complete` when every unit of every product has gone
 * out — one pending unit anywhere keeps it `partial`. An order with no
 * line items at all reads `pending` (nothing to ship yet).
 */
export function summariseFulfilment(
  items: readonly Pick<
    FulfilmentItem,
    'quantityTotal' | 'quantityDispatched'
  >[],
): FulfilmentSummary {
  let unitsTotal = 0;
  let unitsShipped = 0;
  let productsComplete = 0;
  let productsPending = 0;

  for (const item of items) {
    unitsTotal += item.quantityTotal;
    // Clamp so an over-dispatch can't inflate the shipped count past the
    // order size and render "7 of 5 shipped".
    unitsShipped += Math.min(item.quantityDispatched, item.quantityTotal);
    const state = itemFulfilmentState(item);
    if (state === 'complete') productsComplete += 1;
    if (state === 'pending') productsPending += 1;
  }

  const unitsPending = Math.max(0, unitsTotal - unitsShipped);

  let state: ItemFulfilmentState;
  if (unitsShipped <= 0) state = 'pending';
  else if (unitsPending === 0) state = 'complete';
  else state = 'partial';

  return {
    unitsTotal,
    unitsShipped,
    unitsPending,
    productsTotal: items.length,
    productsComplete,
    productsPending,
    state,
  };
}

// =============================================================================
// HVA-305: order-level roll-up for the exec + captain request LISTS
// =============================================================================
//
// The detail page derives its numbers from the full line-item list. A
// paginated list can't afford that, so the queries hand back four
// pre-aggregated counts and this turns them into the same vocabulary.
// =============================================================================

export interface OrderDispatchSummary {
  unitsTotal: number;
  unitsShipped: number;
  unitsPending: number;
  shipmentCount: number;
  deliveredShipmentCount: number;
  state: ItemFulfilmentState;
  /** True when every shipment that went out has been marked delivered. */
  fullyDelivered: boolean;
}

export function deriveOrderDispatchSummary(raw: {
  unitsTotal: number;
  unitsShipped: number;
  shipmentCount: number;
  deliveredShipmentCount: number;
}): OrderDispatchSummary {
  const unitsTotal = Math.max(0, Number(raw.unitsTotal) || 0);
  // Clamp, same reasoning as summariseFulfilment — never render "7 of 5".
  const unitsShipped = Math.min(
    Math.max(0, Number(raw.unitsShipped) || 0),
    unitsTotal,
  );
  const unitsPending = Math.max(0, unitsTotal - unitsShipped);
  const shipmentCount = Math.max(0, Number(raw.shipmentCount) || 0);
  const deliveredShipmentCount = Math.max(
    0,
    Number(raw.deliveredShipmentCount) || 0,
  );

  let state: ItemFulfilmentState;
  if (unitsShipped <= 0) state = 'pending';
  else if (unitsPending === 0) state = 'complete';
  else state = 'partial';

  return {
    unitsTotal,
    unitsShipped,
    unitsPending,
    shipmentCount,
    deliveredShipmentCount,
    state,
    fullyDelivered:
      shipmentCount > 0 &&
      deliveredShipmentCount >= shipmentCount &&
      state === 'complete',
  };
}

/**
 * Short label for the list pill. Kept terse — it sits beside the status
 * badge on a phone, so it has to survive a narrow column.
 */
export function formatDispatchPill(summary: OrderDispatchSummary): string {
  if (summary.fullyDelivered) return 'Delivered';
  if (summary.state === 'complete') return 'All shipped';
  if (summary.state === 'pending') return 'Not shipped';
  return `${summary.unitsShipped} of ${summary.unitsTotal} shipped`;
}

/**
 * One-line human summary for the section header, e.g.
 *   "7 of 12 units shipped · 2 products pending · 3 shipments"
 */
export function formatFulfilmentSummary(
  summary: FulfilmentSummary,
  shipmentCount: number,
): string {
  const parts: string[] = [
    `${summary.unitsShipped} of ${summary.unitsTotal} ${
      summary.unitsTotal === 1 ? 'unit' : 'units'
    } shipped`,
  ];

  const stillPending = summary.productsTotal - summary.productsComplete;
  if (stillPending > 0) {
    parts.push(
      `${stillPending} ${stillPending === 1 ? 'product' : 'products'} pending`,
    );
  }

  parts.push(
    `${shipmentCount} ${shipmentCount === 1 ? 'shipment' : 'shipments'}`,
  );

  return parts.join(' · ');
}
