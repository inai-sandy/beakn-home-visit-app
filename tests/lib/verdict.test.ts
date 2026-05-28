import { describe, expect, it } from 'vitest';

import type { DayCloseMetrics } from '@/lib/today/metrics';
import { computeDayVerdict } from '@/lib/today/verdict';

// HVA-64: verdict derivation for the Close the Day sticky header.

const EMPTY_TARGET = { actual: 0, target: null, status: 'no_target' as const };

function buildMetrics(
  overrides: Partial<DayCloseMetrics> & {
    targets?: Partial<DayCloseMetrics['targets']>;
  } = {},
): DayCloseMetrics {
  const base: DayCloseMetrics = {
    taskCounts: {
      done: 0,
      postponed: 0,
      pending: 0,
      totalAtSubmission: 0,
      addedDuringDay: 0,
      fastCompletionCount: 0,
    },
    variancePct: null,
    estimatedTotalMinutes: 0,
    actualTotalMinutes: 0,
    amountCollectedPaise: 0,
    inboundPaymentCount: 0,
    quotationsCount: 0,
    targets: {
      revenue: { ...EMPTY_TARGET },
      visits: { ...EMPTY_TARGET },
      quotations: { ...EMPTY_TARGET },
      orders: { ...EMPTY_TARGET },
      conversionPct: { ...EMPTY_TARGET, actual: null },
      taskCompletionPct: { ...EMPTY_TARGET, actual: null },
    },
  };
  return {
    ...base,
    ...overrides,
    targets: { ...base.targets, ...(overrides.targets ?? {}) },
  };
}

describe('computeDayVerdict', () => {
  it('returns red verdict when no targets and no activity', () => {
    const v = computeDayVerdict(buildMetrics());
    expect(v.kind).toBe('red');
    expect(v.headline).toBe('Day summary');
  });

  it('returns green when 4+ of 6 targets are met', () => {
    const v = computeDayVerdict(
      buildMetrics({
        targets: {
          revenue: { actual: 50000, target: 40000, status: 'green' },
          visits: { actual: 8, target: 6, status: 'green' },
          quotations: { actual: 4, target: 3, status: 'green' },
          orders: { actual: 3, target: 2, status: 'green' },
          conversionPct: { actual: 30, target: 50, status: 'red' },
          taskCompletionPct: { actual: 80, target: 90, status: 'yellow' },
        },
      }),
    );
    expect(v.kind).toBe('green');
  });

  it('returns yellow when 2 of 6 targets are met', () => {
    const v = computeDayVerdict(
      buildMetrics({
        targets: {
          revenue: { actual: 50000, target: 40000, status: 'green' },
          visits: { actual: 8, target: 6, status: 'green' },
          quotations: { actual: 1, target: 3, status: 'red' },
          orders: { actual: 0, target: 2, status: 'red' },
          conversionPct: { actual: 0, target: 50, status: 'red' },
          taskCompletionPct: { actual: 30, target: 90, status: 'red' },
        },
      }),
    );
    expect(v.kind).toBe('yellow');
  });

  it('returns red when 0-1 of 6 targets are met', () => {
    const v = computeDayVerdict(
      buildMetrics({
        targets: {
          revenue: { actual: 50000, target: 40000, status: 'green' },
          visits: { actual: 1, target: 6, status: 'red' },
          quotations: { actual: 0, target: 3, status: 'red' },
          orders: { actual: 0, target: 2, status: 'red' },
          conversionPct: { actual: 0, target: 50, status: 'red' },
          taskCompletionPct: { actual: 20, target: 90, status: 'red' },
        },
      }),
    );
    expect(v.kind).toBe('red');
  });

  it('headline leads with revenue when collected > 0', () => {
    const v = computeDayVerdict(
      buildMetrics({ amountCollectedPaise: 750000 }),
    );
    expect(v.headline).toMatch(/collected/i);
    expect(v.headline).toContain('7,500');
  });

  it('headline falls back to orders → visits → tasks', () => {
    const ordersOnly = computeDayVerdict(
      buildMetrics({
        targets: {
          orders: { actual: 2, target: null, status: 'no_target' },
        },
      }),
    );
    expect(ordersOnly.headline).toBe('2 orders closed');

    const visitsOnly = computeDayVerdict(
      buildMetrics({
        targets: {
          visits: { actual: 5, target: null, status: 'no_target' },
        },
      }),
    );
    expect(visitsOnly.headline).toBe('5 visits done');

    const tasksOnly = computeDayVerdict(
      buildMetrics({
        taskCounts: {
          done: 3,
          postponed: 1,
          pending: 1,
          totalAtSubmission: 5,
          addedDuringDay: 0,
          fastCompletionCount: 0,
        },
      }),
    );
    expect(tasksOnly.headline).toBe('3/5 tasks done');
  });

  it('untargeted-but-high-variance day reads as green via fallback path', () => {
    const v = computeDayVerdict(
      buildMetrics({
        variancePct: 85,
        taskCounts: {
          done: 8,
          postponed: 1,
          pending: 1,
          totalAtSubmission: 10,
          addedDuringDay: 0,
          fastCompletionCount: 0,
        },
      }),
    );
    expect(v.kind).toBe('green');
  });
});
