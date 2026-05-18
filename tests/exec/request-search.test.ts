import { describe, expect, it } from 'vitest';

import {
  digitsOnly,
  matchesRequestSearch,
} from '@/lib/exec/request-search';

// =============================================================================
// HVA-65: search-match logic for the exec /requests filter (locked decision #7)
// =============================================================================

const ROWS = [
  { customerName: 'Sandy Karnati', customerPhone: '+919885698665' },
  { customerName: 'Veera Reddy', customerPhone: '+919876543210' },
  { customerName: 'Arjun Kumar', customerPhone: '+918888888888' },
  { customerName: 'O\'Sullivan', customerPhone: '+917777777777' },
];

describe('HVA-65 matchesRequestSearch', () => {
  it('empty / whitespace query matches everything', () => {
    for (const r of ROWS) {
      expect(matchesRequestSearch(r, '')).toBe(true);
      expect(matchesRequestSearch(r, '   ')).toBe(true);
    }
  });

  it('matches customer name case-insensitively', () => {
    expect(matchesRequestSearch(ROWS[0], 'sandy')).toBe(true);
    expect(matchesRequestSearch(ROWS[0], 'SANDY')).toBe(true);
    expect(matchesRequestSearch(ROWS[0], 'SaNdY')).toBe(true);
    expect(matchesRequestSearch(ROWS[0], 'KaRnATi')).toBe(true);
    // partial match in the middle of a name
    expect(matchesRequestSearch(ROWS[0], 'rnat')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(matchesRequestSearch(ROWS[0], 'veera')).toBe(false);
    expect(matchesRequestSearch(ROWS[0], 'arjun')).toBe(false);
  });

  it('matches phone using digits-only normalisation on both sides', () => {
    // raw digits
    expect(matchesRequestSearch(ROWS[0], '9885698665')).toBe(true);
    // with country code
    expect(matchesRequestSearch(ROWS[0], '+919885698665')).toBe(true);
    // spaced
    expect(matchesRequestSearch(ROWS[0], '9885 698 665')).toBe(true);
    // dashed
    expect(matchesRequestSearch(ROWS[0], '988-569-8665')).toBe(true);
    // partial digit prefix
    expect(matchesRequestSearch(ROWS[0], '988569')).toBe(true);
  });

  it('non-matching phone returns false', () => {
    expect(matchesRequestSearch(ROWS[0], '1234567890')).toBe(false);
  });

  it('a query that is just punctuation does not falsely match every row', () => {
    // '-' has zero digits — should be treated as the empty-digits case
    // for the phone-leg of the match. The name leg of the match runs
    // ILIKE '%-%' which would match nothing in ROWS.
    for (const r of ROWS) {
      expect(matchesRequestSearch(r, '-')).toBe(false);
    }
  });

  it('apostrophes in names match raw', () => {
    expect(matchesRequestSearch(ROWS[3], "o'sull")).toBe(true);
    expect(matchesRequestSearch(ROWS[3], "Sullivan")).toBe(true);
  });
});

describe('HVA-65 digitsOnly helper', () => {
  it('strips every non-digit character', () => {
    expect(digitsOnly('+91 988-569 8665')).toBe('919885698665');
    expect(digitsOnly('abc')).toBe('');
    expect(digitsOnly('')).toBe('');
  });
});
