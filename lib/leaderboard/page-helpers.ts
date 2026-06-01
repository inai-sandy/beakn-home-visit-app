import { isValidMetric } from '@/components/leaderboard/LeaderboardTabs';

import type {
  LeaderboardMetric,
  LeaderboardWindow,
} from './queries';

// HVA-201: shared search-param parser used by all 3 entry pages.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIstDateString(s: unknown): s is string {
  return typeof s === 'string' && DATE_PATTERN.test(s);
}

export interface LeaderboardPageParams {
  window: LeaderboardWindow;
  metric: LeaderboardMetric;
}

/** Parse `?date=`, `?from=&to=`, `?metric=` URL params. Defaults to a
 *  7-day range ending today (gives the leaderboard a sensible non-empty
 *  default without forcing the user to pick a date). */
export function parseLeaderboardSearchParams(sp: {
  date?: string;
  from?: string;
  to?: string;
  metric?: string;
}): LeaderboardPageParams {
  const metric: LeaderboardMetric = isValidMetric(sp.metric)
    ? sp.metric
    : 'composite';

  // Range mode if both from + to are present and valid.
  if (
    isValidIstDateString(sp.from) &&
    isValidIstDateString(sp.to) &&
    sp.from <= sp.to
  ) {
    return { window: { mode: 'range', from: sp.from, to: sp.to }, metric };
  }
  // Single-date mode if a valid date param is present.
  if (isValidIstDateString(sp.date)) {
    return { window: { mode: 'single', date: sp.date }, metric };
  }
  // Default: last 7 days ending today (range mode).
  const today = istTodayString();
  const sevenAgo = addDaysIstString(today, -6);
  return {
    window: { mode: 'range', from: sevenAgo, to: today },
    metric,
  };
}

function istTodayString(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

function addDaysIstString(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
