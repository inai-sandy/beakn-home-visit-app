import { describe, expect, it } from 'vitest';

import {
  sortTimelineEvents,
  type TimelineEventKind,
} from '@/lib/request-timeline';

// =============================================================================
// HVA-324: the request timeline is ONE chronological story
// HVA-325: …with a third source in it
// =============================================================================
//
// Sandeep, looking at request 019ebacb on 2026-08-04: "see the overall
// activity and how the activity is fluctuating… the order is not right. You
// can see the total flow of the order."
//
// He was right. The page rendered status history and reschedule history as two
// CONCATENATED lists — every status row, then every reschedule row — so that
// request displayed:
//
//   Visit Scheduled      14 Jun
//   Visit Completed       4 Aug   <- marked "current"
//   Visit rescheduled →  14 Jun
//   Visit rescheduled →  15 Jun
//
// Two June events printed below an August one, with the current-stage marker
// stranded mid-list. Nothing was wrong with the DATA; the reading order was.
//
// HVA-325 note: this file used to MIRROR the sort from
// app/requests/[id]/page.tsx rather than import it, because the logic lived
// inline in a server component. That is two copies of one rule with nothing
// forcing them to agree — the exact shape of bug this batch keeps closing, and
// it would have passed happily while the page did something else. The sort
// moved to lib/request-timeline.ts and this now exercises the real function.
// =============================================================================

interface Event {
  kind: TimelineEventKind;
  id: string;
  when: Date;
}

const merge = (events: Event[]) => sortTimelineEvents(events);

describe('HVA-324 timeline ordering', () => {
  it('interleaves reschedules between the status changes they sit between', () => {
    // Exactly request 019ebacb's real data.
    const merged = merge([
      { kind: 'status', id: 'assigned', when: new Date('2026-06-12T08:13:56Z') },
      { kind: 'status', id: 'scheduled', when: new Date('2026-06-14T16:36:55Z') },
      { kind: 'status', id: 'completed', when: new Date('2026-08-04T13:52:15Z') },
      { kind: 'reschedule', id: 'to-20-jun', when: new Date('2026-06-14T17:00:09Z') },
      { kind: 'reschedule', id: 'to-18-jun', when: new Date('2026-06-15T00:43:55Z') },
    ]);

    expect(merged.map((e) => e.id)).toEqual([
      'assigned',
      'scheduled',
      'to-20-jun',
      'to-18-jun',
      'completed',
    ]);
  });

  it('never leaves an older event below a newer one', () => {
    // The property that actually broke: the rendered list must be
    // non-decreasing in time, whatever mix of kinds it holds.
    const merged = merge([
      { kind: 'reschedule', id: 'r1', when: new Date('2026-01-05T00:00:00Z') },
      { kind: 'status', id: 's1', when: new Date('2026-01-01T00:00:00Z') },
      { kind: 'reschedule', id: 'r2', when: new Date('2026-01-02T00:00:00Z') },
      { kind: 'status', id: 's2', when: new Date('2026-01-09T00:00:00Z') },
    ]);

    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i].when.getTime()).toBeGreaterThanOrEqual(
        merged[i - 1].when.getTime(),
      );
    }
    expect(merged.map((e) => e.id)).toEqual(['s1', 'r2', 'r1', 's2']);
  });

  it('puts the status change before a reschedule stamped the same instant', () => {
    // A reschedule always amends a scheduling, so on a tie the status row
    // reads first or the story runs backwards.
    const t = new Date('2026-03-03T10:00:00Z');
    const merged = merge([
      { kind: 'reschedule', id: 'resched', when: t },
      { kind: 'status', id: 'status', when: t },
    ]);
    expect(merged.map((e) => e.id)).toEqual(['status', 'resched']);
  });
});

describe('HVA-325 order changes in the timeline', () => {
  it('places a CartPlus edit between the stages it happened between', () => {
    // Ankit's real order: created, edited ₹4,174 → ₹8,354, confirmed a
    // minute later, cancelled a minute after that.
    const merged = merge([
      { kind: 'status', id: 'quotation-given', when: new Date('2026-07-09T12:12:55Z') },
      { kind: 'status', id: 'order-confirmed', when: new Date('2026-07-09T12:16:02Z') },
      { kind: 'order_change', id: 'value-doubled', when: new Date('2026-07-09T12:14:47Z') },
    ]);

    expect(merged.map((e) => e.id)).toEqual([
      'quotation-given',
      'value-doubled',
      'order-confirmed',
    ]);
  });

  it('holds the non-decreasing property with all three kinds mixed', () => {
    const merged = merge([
      { kind: 'order_change', id: 'c2', when: new Date('2026-02-10T00:00:00Z') },
      { kind: 'reschedule', id: 'r1', when: new Date('2026-02-04T00:00:00Z') },
      { kind: 'status', id: 's2', when: new Date('2026-02-08T00:00:00Z') },
      { kind: 'order_change', id: 'c1', when: new Date('2026-02-02T00:00:00Z') },
      { kind: 'status', id: 's1', when: new Date('2026-02-01T00:00:00Z') },
    ]);

    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i].when.getTime()).toBeGreaterThanOrEqual(
        merged[i - 1].when.getTime(),
      );
    }
    expect(merged.map((e) => e.id)).toEqual(['s1', 'c1', 'r1', 's2', 'c2']);
  });

  it('orders a same-instant status, order change and reschedule as one readable sentence', () => {
    // CartPlus fires the edit and the status flip within the same second on
    // a real confirm, so this tie is not hypothetical.
    const t = new Date('2026-07-09T12:16:02Z');
    const merged = merge([
      { kind: 'reschedule', id: 'resched', when: t },
      { kind: 'order_change', id: 'change', when: t },
      { kind: 'status', id: 'status', when: t },
    ]);
    expect(merged.map((e) => e.id)).toEqual(['status', 'change', 'resched']);
  });

  it('does not mutate the array it was given', () => {
    // The page builds the array inline and the sort must not surprise a
    // future caller that holds a reference to it.
    const input: Event[] = [
      { kind: 'status', id: 'b', when: new Date('2026-05-02T00:00:00Z') },
      { kind: 'status', id: 'a', when: new Date('2026-05-01T00:00:00Z') },
    ];
    const merged = merge(input);
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
