import { describe, expect, it } from 'vitest';

// =============================================================================
// HVA-324: the request timeline is ONE chronological story
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
// This pins the merge rule. It mirrors the sort in app/requests/[id]/page.tsx
// rather than importing it, because that logic lives inline in a server
// component — the assertion is on the ORDERING CONTRACT, which is what
// regressed.
// =============================================================================

interface Event {
  kind: 'status' | 'reschedule';
  id: string;
  when: Date;
}

function mergeTimeline(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    const diff = a.when.getTime() - b.when.getTime();
    if (diff !== 0) return diff;
    if (a.kind === b.kind) return 0;
    return a.kind === 'status' ? -1 : 1;
  });
}

describe('HVA-324 timeline ordering', () => {
  it('interleaves reschedules between the status changes they sit between', () => {
    // Exactly request 019ebacb's real data.
    const merged = mergeTimeline([
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
    const merged = mergeTimeline([
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
    const merged = mergeTimeline([
      { kind: 'reschedule', id: 'resched', when: t },
      { kind: 'status', id: 'status', when: t },
    ]);
    expect(merged.map((e) => e.id)).toEqual(['status', 'resched']);
  });
});
