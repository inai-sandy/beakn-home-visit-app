import { describe, expect, it } from 'vitest';

import { isDispatchable, ORDER_CONFIRMED_SEQ } from '@/lib/dispatch/eligibility';

// =============================================================================
// HVA-328: cancelled orders must leave the dispatch pipeline
// =============================================================================
//
// The pure half of the rule. The SQL half and the write guard are covered by
// tests/support/dispatch-cancelled.test.ts against a real database — this file
// just pins the predicate itself, which the pill and the guard both call.
// =============================================================================

describe('isDispatchable', () => {
  it('is false below ORDER_CONFIRMED, exactly as the old stage-only gate was', () => {
    expect(
      isDispatchable({ statusSequence: 5, cancelledAt: null }),
    ).toBe(false);
  });

  it('is true at ORDER_CONFIRMED and beyond when not cancelled', () => {
    for (const seq of [ORDER_CONFIRMED_SEQ, 7, 8, 9, 10]) {
      expect(isDispatchable({ statusSequence: seq, cancelledAt: null })).toBe(
        true,
      );
    }
  });

  // The actual defect. A request keeps whatever stage it was cancelled at —
  // cancellation writes a from = to history row and never moves the stage — so
  // a request cancelled at Order Confirmed satisfies `sequence >= 6` forever.
  // Gating on the stage alone is what left four production orders sitting in
  // the support queue with a live Dispatch button.
  it('is false once cancelled, at every stage that would otherwise qualify', () => {
    const cancelledAt = new Date('2026-07-09T12:17:21.195Z');
    for (const seq of [ORDER_CONFIRMED_SEQ, 7, 8, 9, 10]) {
      expect(isDispatchable({ statusSequence: seq, cancelledAt })).toBe(false);
    }
  });

  it('treats a cancellation timestamp as cancelled however it arrives from the driver', () => {
    // Drizzle hands back a Date; a raw query or a serialized payload can hand
    // back the ISO string. Both mean cancelled.
    expect(
      isDispatchable({ statusSequence: 6, cancelledAt: new Date() }),
    ).toBe(false);
    expect(
      isDispatchable({
        statusSequence: 6,
        cancelledAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});
