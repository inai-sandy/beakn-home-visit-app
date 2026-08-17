import { describe, expect, it } from 'vitest';

import {
  deriveOrderDispatchSummary,
  formatDispatchPill,
  formatFulfilmentSummary,
  isDispatchVisible,
  itemFulfilmentState,
  summariseFulfilment,
} from '@/lib/dispatch/fulfilment';

// =============================================================================
// HVA-302: per-product fulfilment derivations
// =============================================================================
//
// Orders ship in installments, so the partial cases below are the normal
// path, not edge cases. Pure functions — no DB.
// =============================================================================

function item(quantityTotal: number, quantityDispatched: number) {
  return { quantityTotal, quantityDispatched, removedAt: null };
}

/** HVA-340: a line item a CartPlus edit dropped from the order. */
function removedItem(quantityTotal: number, quantityDispatched: number) {
  return {
    quantityTotal,
    quantityDispatched,
    removedAt: new Date('2026-08-17T10:00:00Z'),
  };
}

describe('itemFulfilmentState', () => {
  it('is pending when nothing has gone out', () => {
    expect(itemFulfilmentState(item(5, 0))).toBe('pending');
  });

  it('is partial when some but not all units have gone out', () => {
    expect(itemFulfilmentState(item(5, 3))).toBe('partial');
  });

  it('is complete when every unit has gone out', () => {
    expect(itemFulfilmentState(item(5, 5))).toBe('complete');
  });

  it('reads an over-dispatch as complete, never as pending', () => {
    // Guards against a sign slip turning a data glitch into "not shipped",
    // which would be the most misleading possible answer for the exec.
    expect(itemFulfilmentState(item(5, 6))).toBe('complete');
  });

  it('treats an empty line as pending rather than complete', () => {
    expect(itemFulfilmentState(item(0, 0))).toBe('pending');
  });

  // HVA-340 — removal outranks the shipped/pending axis entirely.
  it('is removed when the customer dropped the item, even with nothing shipped', () => {
    // This is the case that mattered: reading as "pending" is what put the
    // row in dispatchableIds and offered support a working Dispatch form.
    expect(itemFulfilmentState(removedItem(5, 0))).toBe('removed');
  });

  it('is removed even when some units already went out before the removal', () => {
    expect(itemFulfilmentState(removedItem(5, 2))).toBe('removed');
  });

  it('is removed even when the whole line had already shipped', () => {
    expect(itemFulfilmentState(removedItem(5, 5))).toBe('removed');
  });
});

describe('summariseFulfilment', () => {
  it('rolls units and products up across a mixed order', () => {
    const summary = summariseFulfilment([
      item(2, 2), // complete
      item(5, 3), // partial
      item(1, 0), // pending
    ]);

    expect(summary.unitsTotal).toBe(8);
    expect(summary.unitsShipped).toBe(5);
    expect(summary.unitsPending).toBe(3);
    expect(summary.productsTotal).toBe(3);
    expect(summary.productsComplete).toBe(1);
    expect(summary.productsPending).toBe(1);
    expect(summary.state).toBe('partial');
  });

  it('is pending when no installment has gone out yet', () => {
    const summary = summariseFulfilment([item(2, 0), item(3, 0)]);
    expect(summary.state).toBe('pending');
    expect(summary.unitsShipped).toBe(0);
  });

  it('is complete only when every unit of every product has shipped', () => {
    const summary = summariseFulfilment([item(2, 2), item(3, 3)]);
    expect(summary.state).toBe('complete');
    expect(summary.unitsPending).toBe(0);
  });

  it('stays partial when a single unit is outstanding', () => {
    const summary = summariseFulfilment([item(2, 2), item(3, 2)]);
    expect(summary.state).toBe('partial');
    expect(summary.unitsPending).toBe(1);
  });

  it('clamps an over-dispatch so shipped never exceeds ordered', () => {
    const summary = summariseFulfilment([item(5, 7)]);
    expect(summary.unitsShipped).toBe(5);
    expect(summary.unitsPending).toBe(0);
    expect(summary.state).toBe('complete');
  });

  it('handles an order with no line items', () => {
    const summary = summariseFulfilment([]);
    expect(summary.unitsTotal).toBe(0);
    expect(summary.productsTotal).toBe(0);
    expect(summary.state).toBe('pending');
  });

  // HVA-340 — the totals describe the order as it stands NOW.
  it('leaves a removed item out of the units and product totals', () => {
    const summary = summariseFulfilment([
      item(2, 2), // complete
      item(3, 1), // partial
      removedItem(5, 0), // customer deleted this one
    ]);

    // 2 + 3 = 5 live units, not 10. Before this, the exec's header read
    // "3 of 10 units shipped · 2 products pending" for an order the
    // customer had cut down to five units.
    expect(summary.unitsTotal).toBe(5);
    expect(summary.unitsShipped).toBe(3);
    expect(summary.unitsPending).toBe(2);
    expect(summary.productsTotal).toBe(2);
    expect(summary.state).toBe('partial');
  });

  it('reads complete once every LIVE unit has shipped, ignoring a removed line', () => {
    // The removed item has nothing shipped, so before HVA-340 this order
    // was stuck reporting "partial" forever — an order that is, in fact,
    // fully delivered as it currently stands.
    const summary = summariseFulfilment([item(2, 2), removedItem(4, 0)]);
    expect(summary.state).toBe('complete');
    expect(summary.unitsPending).toBe(0);
  });

  it('does not count units shipped before a removal against the live total', () => {
    // Partly shipped, then removed. Those 2 units really did go out, and
    // the dispatch history still records them — but they are not progress
    // against what we currently owe, and counting them here produced
    // "2 of 0 shipped".
    const summary = summariseFulfilment([removedItem(5, 2)]);
    expect(summary.unitsTotal).toBe(0);
    expect(summary.unitsShipped).toBe(0);
    expect(summary.productsTotal).toBe(0);
  });
});

describe('formatFulfilmentSummary', () => {
  it('reads naturally for a partially shipped order', () => {
    const summary = summariseFulfilment([item(2, 2), item(5, 3), item(1, 0)]);
    expect(formatFulfilmentSummary(summary, 3)).toBe(
      '5 of 8 units shipped · 2 products pending · 3 shipments',
    );
  });

  it('drops the pending clause once everything has shipped', () => {
    const summary = summariseFulfilment([item(2, 2)]);
    expect(formatFulfilmentSummary(summary, 1)).toBe(
      '2 of 2 units shipped · 1 shipment',
    );
  });

  it('singularises unit and shipment counts', () => {
    const summary = summariseFulfilment([item(1, 1)]);
    expect(formatFulfilmentSummary(summary, 1)).toBe(
      '1 of 1 unit shipped · 1 shipment',
    );
  });
});

// =============================================================================
// HVA-305: order-level roll-up for the list pill
// =============================================================================

describe('isDispatchVisible', () => {
  it('hides dispatch state before ORDER_CONFIRMED', () => {
    expect(isDispatchVisible(5)).toBe(false); // QUOTATION_GIVEN
  });

  it('shows it from ORDER_CONFIRMED onward', () => {
    expect(isDispatchVisible(6)).toBe(true); // ORDER_CONFIRMED
  });

  it('keeps showing it at the stages the old code list missed', () => {
    // The original gate listed a non-existent 'INSTALLATION_DONE' and so
    // skipped INSTALLATION_CONFIGURATION_DONE (8) and
    // PENDING_CAPTAIN_APPROVAL (9) entirely.
    expect(isDispatchVisible(8)).toBe(true);
    expect(isDispatchVisible(9)).toBe(true);
    expect(isDispatchVisible(10)).toBe(true);
  });
});

describe('deriveOrderDispatchSummary', () => {
  it('reads a part-shipped order as partial', () => {
    const s = deriveOrderDispatchSummary({
      unitsTotal: 8,
      unitsShipped: 3,
      shipmentCount: 1,
      deliveredShipmentCount: 0,
    });
    expect(s.state).toBe('partial');
    expect(s.unitsPending).toBe(5);
    expect(s.fullyDelivered).toBe(false);
    expect(formatDispatchPill(s)).toBe('3 of 8 shipped');
  });

  it('reads an untouched order as pending', () => {
    const s = deriveOrderDispatchSummary({
      unitsTotal: 8,
      unitsShipped: 0,
      shipmentCount: 0,
      deliveredShipmentCount: 0,
    });
    expect(s.state).toBe('pending');
    expect(formatDispatchPill(s)).toBe('Not shipped');
  });

  it('separates all-shipped from actually-delivered', () => {
    const shipped = deriveOrderDispatchSummary({
      unitsTotal: 5,
      unitsShipped: 5,
      shipmentCount: 2,
      deliveredShipmentCount: 1,
    });
    expect(shipped.state).toBe('complete');
    expect(shipped.fullyDelivered).toBe(false);
    expect(formatDispatchPill(shipped)).toBe('All shipped');

    const delivered = deriveOrderDispatchSummary({
      unitsTotal: 5,
      unitsShipped: 5,
      shipmentCount: 2,
      deliveredShipmentCount: 2,
    });
    expect(delivered.fullyDelivered).toBe(true);
    expect(formatDispatchPill(delivered)).toBe('Delivered');
  });

  it('does not claim delivered while units are still outstanding', () => {
    // Every shipment SO FAR is delivered, but the order isn't fully out.
    const s = deriveOrderDispatchSummary({
      unitsTotal: 8,
      unitsShipped: 3,
      shipmentCount: 1,
      deliveredShipmentCount: 1,
    });
    expect(s.fullyDelivered).toBe(false);
    expect(formatDispatchPill(s)).toBe('3 of 8 shipped');
  });

  it('clamps an over-dispatch instead of rendering "7 of 5"', () => {
    const s = deriveOrderDispatchSummary({
      unitsTotal: 5,
      unitsShipped: 7,
      shipmentCount: 1,
      deliveredShipmentCount: 0,
    });
    expect(s.unitsShipped).toBe(5);
    expect(s.unitsPending).toBe(0);
    expect(formatDispatchPill(s)).toBe('All shipped');
  });

  it('survives an order with no line items', () => {
    const s = deriveOrderDispatchSummary({
      unitsTotal: 0,
      unitsShipped: 0,
      shipmentCount: 0,
      deliveredShipmentCount: 0,
    });
    expect(s.unitsTotal).toBe(0);
    expect(s.state).toBe('pending');
  });
});
