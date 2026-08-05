import { describe, expect, it } from 'vitest';

import { describeOrderChange } from '@/lib/order-change-summary';
import {
  diffOrder,
  type IncomingLine,
  type OrderSnapshot,
} from '@/lib/webhooks/cartplus/order-change';

// =============================================================================
// HVA-325: did this CartPlus edit actually change the order?
// =============================================================================
//
// Everything hangs off this question — whether a row is written, whether the
// team is told — so it is a pure function and tested exhaustively here rather
// than through the webhook handler, which cannot practically be driven
// through every combination of edit.
//
// The rule, from Sandeep's brief:
//   material   → the total value, or an item added / removed / amended
//   cosmetic   → product name, SKU, notes — CartPlus fires the same webhook
//                for a spelling fix, and an alert that goes off for spelling
//                fixes gets swiped away along with the ones that matter.
// =============================================================================

function snapshot(
  totalPaise: number,
  lines: Array<[number, number, number]>,
): OrderSnapshot {
  return {
    totalPaise,
    lines: new Map(
      lines.map(([id, quantity, unitPricePaise]) => [
        id,
        { quantity, unitPricePaise },
      ]),
    ),
  };
}

function line(
  id: number,
  quantity: number,
  unitPricePaise: number,
): IncomingLine {
  return { id, quantity, unitPricePaise };
}

describe('diffOrder — material changes', () => {
  it('flags a total that moved', () => {
    // Ankit's real order, CP-20260709-PNV2NR: ₹4,174 → ₹8,354.
    const before = snapshot(417_400, [[11, 1, 417_400]]);
    const diff = diffOrder(before, 835_400, [
      line(11, 1, 417_400),
      line(12, 1, 418_000),
    ]);

    expect(diff.material).toBe(true);
    expect(diff.previousTotalPaise).toBe(417_400);
    expect(diff.newTotalPaise).toBe(835_400);
    expect(diff.itemsAdded).toBe(1);
    expect(diff.previousItemCount).toBe(1);
    expect(diff.newItemCount).toBe(2);
  });

  it('flags an item removed', () => {
    const before = snapshot(300_000, [
      [11, 1, 100_000],
      [12, 1, 200_000],
    ]);
    const diff = diffOrder(before, 100_000, [line(11, 1, 100_000)]);

    expect(diff.material).toBe(true);
    expect(diff.itemsRemoved).toBe(1);
    expect(diff.itemsAdded).toBe(0);
    expect(diff.newItemCount).toBe(1);
  });

  it('flags a quantity change', () => {
    const before = snapshot(100_000, [[11, 1, 100_000]]);
    const diff = diffOrder(before, 200_000, [line(11, 2, 100_000)]);

    expect(diff.material).toBe(true);
    expect(diff.itemsAmended).toBe(1);
    expect(diff.itemsAdded).toBe(0);
    expect(diff.itemsRemoved).toBe(0);
  });

  it('flags a unit price change even when the grand total is unchanged', () => {
    // Two lines swapping value between them: the customer is paying the same
    // money for a different thing, which is exactly the sort of edit someone
    // needs to see before a van is loaded.
    const before = snapshot(300_000, [
      [11, 1, 100_000],
      [12, 1, 200_000],
    ]);
    const diff = diffOrder(before, 300_000, [
      line(11, 1, 200_000),
      line(12, 1, 100_000),
    ]);

    expect(diff.material).toBe(true);
    expect(diff.itemsAmended).toBe(2);
    expect(diff.previousTotalPaise).toBe(diff.newTotalPaise);
  });

  it('counts a re-added item as added', () => {
    // A previous edit soft-removed it, so it is not in the active snapshot.
    // The order gaining it back is a real change.
    const before = snapshot(100_000, [[11, 1, 100_000]]);
    const diff = diffOrder(before, 300_000, [
      line(11, 1, 100_000),
      line(12, 1, 200_000),
    ]);

    expect(diff.material).toBe(true);
    expect(diff.itemsAdded).toBe(1);
  });

  it('reports added, removed and amended together', () => {
    const before = snapshot(300_000, [
      [11, 1, 100_000],
      [12, 1, 200_000],
    ]);
    const diff = diffOrder(before, 450_000, [
      line(11, 2, 100_000), // amended
      line(13, 1, 250_000), // added; 12 removed
    ]);

    expect(diff.itemsAdded).toBe(1);
    expect(diff.itemsRemoved).toBe(1);
    expect(diff.itemsAmended).toBe(1);
  });
});

describe('diffOrder — what must NOT fire', () => {
  it('ignores an edit that changes nothing', () => {
    // This is what makes the duplicate delivery harmless: CartPlus sends
    // `order.updated` and `order.status_changed` ~200ms apart for the same
    // edit, and the second one compares the payload against a snapshot that
    // already matches it.
    const before = snapshot(417_400, [[11, 1, 417_400]]);
    const diff = diffOrder(before, 417_400, [line(11, 1, 417_400)]);

    expect(diff.material).toBe(false);
    expect(diff.itemsAdded).toBe(0);
    expect(diff.itemsRemoved).toBe(0);
    expect(diff.itemsAmended).toBe(0);
  });

  it('ignores a cosmetic edit — name, SKU and notes are not inputs', () => {
    // diffOrder is only given id / quantity / unit price precisely so a
    // rename cannot reach it. Same ids, same numbers → nothing happened.
    const before = snapshot(100_000, [[11, 1, 100_000]]);
    const diff = diffOrder(before, 100_000, [line(11, 1, 100_000)]);
    expect(diff.material).toBe(false);
  });

  it('ignores re-ordering of the same lines', () => {
    const before = snapshot(300_000, [
      [11, 1, 100_000],
      [12, 1, 200_000],
    ]);
    const diff = diffOrder(before, 300_000, [
      line(12, 1, 200_000),
      line(11, 1, 100_000),
    ]);
    expect(diff.material).toBe(false);
  });
});

describe('describeOrderChange — the timeline sentence', () => {
  it('leads with the money', () => {
    expect(
      describeOrderChange({
        previousTotalPaise: 417_400,
        newTotalPaise: 835_400,
        previousItemCount: 2,
        newItemCount: 3,
        itemsAdded: 1,
        itemsRemoved: 0,
        itemsAmended: 0,
      }),
    ).toBe('₹4,174 → ₹8,354 · 1 added (2 → 3 items)');
  });

  it('omits the item clause when only the money moved', () => {
    const text = describeOrderChange({
      previousTotalPaise: 300_000,
      newTotalPaise: 250_000,
      previousItemCount: 2,
      newItemCount: 2,
      itemsAdded: 0,
      itemsRemoved: 0,
      itemsAmended: 0,
    });
    expect(text).toBe('₹3,000 → ₹2,500');
    expect(text).not.toContain('items');
  });

  it('omits the money clause when the total held', () => {
    const text = describeOrderChange({
      previousTotalPaise: 300_000,
      newTotalPaise: 300_000,
      previousItemCount: 2,
      newItemCount: 2,
      itemsAdded: 0,
      itemsRemoved: 0,
      itemsAmended: 2,
    });
    expect(text).toBe('2 changed (2 → 2 items)');
    expect(text).not.toContain('→ ₹');
  });

  it('never renders an empty line in the timeline', () => {
    // A row exists because something changed, so a blank description would
    // be a lie about the row's own existence.
    const text = describeOrderChange({
      previousTotalPaise: 100_000,
      newTotalPaise: 100_000,
      previousItemCount: 1,
      newItemCount: 1,
      itemsAdded: 0,
      itemsRemoved: 0,
      itemsAmended: 0,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toBe('Edited in CartPlus');
  });
});
