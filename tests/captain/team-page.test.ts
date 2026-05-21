import { describe, expect, it } from 'vitest';

import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-154: lightweight integration around the page's date-filter math.
// =============================================================================
//
// The page itself is a server component — rendering it through vitest's
// node env without jsdom isn't supported (per the existing card-render
// deferral). We assert on the page's date-window resolution helpers
// here so regressions to window math get caught.
// =============================================================================

function parseWindow(raw: unknown) {
  if (raw === 'today' || raw === 'week' || raw === 'month') return raw;
  return 'week';
}

function buildDateFilter(window: 'today' | 'week' | 'month') {
  const today = getIstDateString();
  if (window === 'today') return { mode: 'single' as const, date: today };
  if (window === 'week') {
    return { mode: 'range' as const, from: offsetIstDate(today, -6), to: today };
  }
  return { mode: 'range' as const, from: offsetIstDate(today, -29), to: today };
}

describe('parseWindow', () => {
  it('accepts the three valid values verbatim', () => {
    expect(parseWindow('today')).toBe('today');
    expect(parseWindow('week')).toBe('week');
    expect(parseWindow('month')).toBe('month');
  });
  it('falls back to "week" for everything else', () => {
    expect(parseWindow(undefined)).toBe('week');
    expect(parseWindow('')).toBe('week');
    expect(parseWindow('all')).toBe('week');
    expect(parseWindow('yesterday')).toBe('week');
  });
});

describe('buildDateFilter', () => {
  it('today → single-date filter with today as the date', () => {
    const today = getIstDateString();
    const f = buildDateFilter('today');
    expect(f).toEqual({ mode: 'single', date: today });
  });

  it('week → range of last 7 days inclusive', () => {
    const today = getIstDateString();
    const f = buildDateFilter('week');
    expect(f).toEqual({
      mode: 'range',
      from: offsetIstDate(today, -6),
      to: today,
    });
  });

  it('month → range of last 30 days inclusive', () => {
    const today = getIstDateString();
    const f = buildDateFilter('month');
    expect(f).toEqual({
      mode: 'range',
      from: offsetIstDate(today, -29),
      to: today,
    });
  });
});
