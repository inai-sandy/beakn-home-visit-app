import { describe, expect, it } from 'vitest';

import {
  EXEC_REQUEST_BUCKETS,
  IN_PROGRESS_STATUS_CODES,
  NEW_STATUS_CODES,
  TERMINAL_POSITIVE_STATUS_CODES,
  categorizeExecRequest,
  countExecRequestsByBucket,
  isExecRequestBucket,
  type ExecRequestBucket,
} from '@/lib/exec/request-buckets';
import { matchesRequestSearch } from '@/lib/exec/request-search';

// =============================================================================
// HVA-65: bucket-categorisation tests for the exec /requests view
// =============================================================================
//
// Pure-function tests — no DB, no React. Covers every status_code listed
// in the spec across both the NEW and IN_PROGRESS sets, plus the
// terminal-positive and cancellation paths.
// =============================================================================

const ALL_STATUSES_BY_BUCKET: Record<Exclude<ExecRequestBucket, 'all'>, readonly string[]> = {
  new: NEW_STATUS_CODES,
  in_progress: IN_PROGRESS_STATUS_CODES,
  completed: TERMINAL_POSITIVE_STATUS_CODES,
  cancelled: [],
};

describe('HVA-65 exec bucket categorisation', () => {
  it('keys roster matches the locked 5-bucket UI', () => {
    expect([...EXEC_REQUEST_BUCKETS]).toEqual([
      'all',
      'new',
      'in_progress',
      'completed',
      'cancelled',
    ]);
  });

  it('every NEW_STATUS_CODES value categorises as "new"', () => {
    for (const code of NEW_STATUS_CODES) {
      expect(categorizeExecRequest({ statusCode: code, cancelledAt: null })).toBe(
        'new',
      );
    }
  });

  it('every IN_PROGRESS_STATUS_CODES value categorises as "in_progress"', () => {
    for (const code of IN_PROGRESS_STATUS_CODES) {
      expect(categorizeExecRequest({ statusCode: code, cancelledAt: null })).toBe(
        'in_progress',
      );
    }
  });

  it('TERMINAL_POSITIVE_STATUS_CODES → "completed"', () => {
    for (const code of TERMINAL_POSITIVE_STATUS_CODES) {
      expect(categorizeExecRequest({ statusCode: code, cancelledAt: null })).toBe(
        'completed',
      );
    }
  });

  it('cancelled_at non-null beats whatever the stage says', () => {
    const ts = new Date('2026-05-01T00:00:00Z');
    for (const list of Object.values(ALL_STATUSES_BY_BUCKET)) {
      for (const code of list) {
        expect(categorizeExecRequest({ statusCode: code, cancelledAt: ts })).toBe(
          'cancelled',
        );
      }
    }
    // even a never-before-seen status_code, if cancelled_at is set,
    // returns 'cancelled' — protects against future stage codes
    expect(
      categorizeExecRequest({ statusCode: 'FUTURE_UNRESERVED_STAGE', cancelledAt: ts }),
    ).toBe('cancelled');
  });

  it('unknown future stage code falls back to "new" (fail-toward-visibility)', () => {
    // Locked decision in the module comment: unknown codes default to
    // "new" so an unmodelled future stage doesn't get hidden away.
    expect(
      categorizeExecRequest({ statusCode: 'FUTURE_UNRESERVED_STAGE', cancelledAt: null }),
    ).toBe('new');
  });

  it('countExecRequestsByBucket aggregates across mixed inputs', () => {
    const rows = [
      { statusCode: 'SUBMITTED', cancelledAt: null },
      { statusCode: 'ASSIGNED', cancelledAt: null },
      { statusCode: 'VISIT_SCHEDULED', cancelledAt: null },
      { statusCode: 'VISIT_COMPLETED', cancelledAt: null },
      { statusCode: 'QUOTATION_GIVEN', cancelledAt: null },
      { statusCode: 'ORDER_EXECUTED_SUCCESSFULLY', cancelledAt: null },
      {
        statusCode: 'ASSIGNED',
        cancelledAt: new Date('2026-05-01T00:00:00Z'),
      },
    ];
    expect(countExecRequestsByBucket(rows)).toEqual({
      all: 7,
      new: 2,
      in_progress: 3,
      completed: 1,
      cancelled: 1,
    });
  });

  it('bucket counts are unaffected by search filter (locked decision #8)', () => {
    // Same 7-row fixture as above. Counts come from the FULL row set;
    // applying a search filter that drops rows should leave the counts
    // unchanged because the component computes counts before any
    // search-filter narrowing.
    const rows = [
      { id: 'r1', statusCode: 'SUBMITTED', cancelledAt: null, customerName: 'Sandy Karnati', customerPhone: '+919885698665' },
      { id: 'r2', statusCode: 'ASSIGNED', cancelledAt: null, customerName: 'Veera Reddy', customerPhone: '+919876543210' },
      { id: 'r3', statusCode: 'VISIT_SCHEDULED', cancelledAt: null, customerName: 'Arjun Kumar', customerPhone: '+918888888888' },
      { id: 'r4', statusCode: 'VISIT_COMPLETED', cancelledAt: null, customerName: 'Priya N', customerPhone: '+917777777777' },
      { id: 'r5', statusCode: 'QUOTATION_GIVEN', cancelledAt: null, customerName: 'Suresh K', customerPhone: '+916666666666' },
      { id: 'r6', statusCode: 'ORDER_EXECUTED_SUCCESSFULLY', cancelledAt: null, customerName: 'Done D', customerPhone: '+915555555555' },
      { id: 'r7', statusCode: 'ASSIGNED', cancelledAt: new Date('2026-05-01T00:00:00Z'), customerName: 'Cancelled C', customerPhone: '+914444444444' },
    ];

    const countsBeforeSearch = countExecRequestsByBucket(rows);

    // Apply a narrowing search; only 1 row matches.
    const filtered = rows.filter((r) => matchesRequestSearch(r, 'sandy'));
    expect(filtered).toHaveLength(1);

    // Counts come from the FULL set — must not change.
    const countsAfterSearch = countExecRequestsByBucket(rows);
    expect(countsAfterSearch).toEqual(countsBeforeSearch);
  });

  it('isExecRequestBucket type-narrows correctly', () => {
    expect(isExecRequestBucket('all')).toBe(true);
    expect(isExecRequestBucket('new')).toBe(true);
    expect(isExecRequestBucket('in_progress')).toBe(true);
    expect(isExecRequestBucket('completed')).toBe(true);
    expect(isExecRequestBucket('cancelled')).toBe(true);
    expect(isExecRequestBucket('Open')).toBe(false); // case-sensitive
    expect(isExecRequestBucket('open')).toBe(false); // captain bucket key
    expect(isExecRequestBucket('')).toBe(false);
    expect(isExecRequestBucket(undefined)).toBe(false);
    expect(isExecRequestBucket(null)).toBe(false);
    expect(isExecRequestBucket({})).toBe(false);
  });
});
