import type {
  LeaderboardMetric,
  LeaderboardWindow,
} from './queries';

import {
  isValidMetric,
  isValidWindow,
} from '@/components/leaderboard/LeaderboardTabs';

// HVA-201: shared search-param parser used by all 3 entry pages.

export interface LeaderboardPageParams {
  window: LeaderboardWindow;
  metric: LeaderboardMetric;
}

export function parseLeaderboardSearchParams(sp: {
  window?: string;
  metric?: string;
}): LeaderboardPageParams {
  return {
    window: isValidWindow(sp.window) ? sp.window : 'this_week',
    metric: isValidMetric(sp.metric) ? sp.metric : 'composite',
  };
}
