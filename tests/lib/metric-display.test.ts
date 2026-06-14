import { describe, expect, it } from 'vitest';

import {
  formatMetricValue,
  isMetricTileVisible,
  showsAsOfTodayBadge,
} from '@/lib/dashboard/metric-display';
import { METRIC_DEFINITIONS } from '@/lib/metrics/registry';

describe('formatMetricValue', () => {
  it('paise → rupees', () => {
    expect(formatMetricValue('paise', 1234500)).toBe('₹12,345');
  });
  it('percent rounds and appends %', () => {
    expect(formatMetricValue('percent', 42.6)).toBe('43%');
  });
  it('count uses Indian grouping', () => {
    expect(formatMetricValue('count', 12345)).toBe('12,345');
  });
  it('minutes → compact h/m', () => {
    expect(formatMetricValue('minutes', 0)).toBe('0m');
    expect(formatMetricValue('minutes', 45)).toBe('45m');
    expect(formatMetricValue('minutes', 90)).toBe('1h 30m');
    expect(formatMetricValue('minutes', 120)).toBe('2h');
  });
  it('null → em dash (e.g. conversion with no visits)', () => {
    expect(formatMetricValue('percent', null)).toBe('—');
  });
});

describe('isMetricTileVisible', () => {
  const range = { temporality: 'range' as const };
  const snapshot = { temporality: 'snapshot' as const };
  const pinnedSnapshot = {
    temporality: 'snapshot' as const,
    pinWhenSnapshot: true,
  };

  it('range tiles always show', () => {
    expect(isMetricTileVisible(range, { isTodayRange: true })).toBe(true);
    expect(isMetricTileVisible(range, { isTodayRange: false })).toBe(true);
  });
  it('plain snapshot tiles show only on a today range', () => {
    expect(isMetricTileVisible(snapshot, { isTodayRange: true })).toBe(true);
    expect(isMetricTileVisible(snapshot, { isTodayRange: false })).toBe(false);
  });
  it('pinned snapshot (Outstanding) always shows', () => {
    expect(isMetricTileVisible(pinnedSnapshot, { isTodayRange: true })).toBe(
      true,
    );
    expect(isMetricTileVisible(pinnedSnapshot, { isTodayRange: false })).toBe(
      true,
    );
  });
});

describe('showsAsOfTodayBadge', () => {
  it('only a pinned snapshot on a non-today range gets the badge', () => {
    const pinned = { temporality: 'snapshot' as const, pinWhenSnapshot: true };
    expect(showsAsOfTodayBadge(pinned, { isTodayRange: false })).toBe(true);
    expect(showsAsOfTodayBadge(pinned, { isTodayRange: true })).toBe(false);
    expect(
      showsAsOfTodayBadge(
        { temporality: 'range' },
        { isTodayRange: false },
      ),
    ).toBe(false);
  });
});

// Guard the registry tagging itself so a new metric can't ship untagged
// or with the snapshot/range split silently wrong.
describe('registry temporality tags', () => {
  it('every metric is tagged range or snapshot', () => {
    for (const def of Object.values(METRIC_DEFINITIONS)) {
      expect(['range', 'snapshot']).toContain(def.temporality);
    }
  });
  it('outstanding + pending_approvals are the snapshots; outstanding is pinned', () => {
    expect(METRIC_DEFINITIONS.outstanding.temporality).toBe('snapshot');
    expect(METRIC_DEFINITIONS.outstanding.pinWhenSnapshot).toBe(true);
    expect(METRIC_DEFINITIONS.pending_approvals.temporality).toBe('snapshot');
    expect(METRIC_DEFINITIONS.pending_approvals.pinWhenSnapshot).toBeFalsy();
    expect(METRIC_DEFINITIONS.revenue.temporality).toBe('range');
  });
});
