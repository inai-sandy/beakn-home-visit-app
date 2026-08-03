import { describe, expect, it } from 'vitest';

import {
  formatFulfilmentSummary,
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
  return { quantityTotal, quantityDispatched };
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
