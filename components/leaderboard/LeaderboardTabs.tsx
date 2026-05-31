import Link from 'next/link';

import { cn } from '@/lib/utils';

import type {
  LeaderboardMetric,
  LeaderboardWindow,
} from '@/lib/leaderboard/queries';

// HVA-201: URL-driven tab nav. Two strips:
//   1. Time window (Today / This Week / This Month)
//   2. Metric (Beakn Score / Revenue / Visits / Quotations / Orders /
//      Conversion / Task completion)
// Both server-rendered as Link arrays so the page stays bookmarkable +
// shareable; no JS needed for tab switching.

export const TIME_TABS: { value: LeaderboardWindow; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
];

export const METRIC_TABS: { value: LeaderboardMetric; label: string }[] = [
  { value: 'composite', label: 'Beakn Score' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'visits', label: 'Visits' },
  { value: 'quotations', label: 'Quotations' },
  { value: 'orders', label: 'Orders' },
  { value: 'conversion_pct', label: 'Conversion %' },
  { value: 'task_completion_pct', label: 'Task %' },
];

interface Props {
  basePath: string;
  activeWindow: LeaderboardWindow;
  activeMetric: LeaderboardMetric;
}

function buildHref(
  basePath: string,
  windowVal: LeaderboardWindow,
  metric: LeaderboardMetric,
): string {
  const sp = new URLSearchParams();
  if (windowVal !== 'this_week') sp.set('window', windowVal);
  if (metric !== 'composite') sp.set('metric', metric);
  const qs = sp.toString();
  return qs.length > 0 ? `${basePath}?${qs}` : basePath;
}

export function LeaderboardTimeTabs({
  basePath,
  activeWindow,
  activeMetric,
}: Props) {
  return (
    <nav aria-label="Time window" className="border-b bg-card">
      <div className="mx-auto max-w-2xl overflow-x-auto">
        <ul className="flex items-center gap-1 px-2 sm:px-4 min-w-max">
          {TIME_TABS.map((tab) => {
            const active = tab.value === activeWindow;
            return (
              <li key={tab.value}>
                <Link
                  href={buildHref(basePath, tab.value, activeMetric)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors',
                    active
                      ? 'border-primary text-primary font-semibold'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export function LeaderboardMetricTabs({
  basePath,
  activeWindow,
  activeMetric,
}: Props) {
  return (
    <nav aria-label="Metric" className="border-b bg-muted/30">
      <div className="mx-auto max-w-2xl overflow-x-auto">
        <ul className="flex items-center gap-1 px-2 sm:px-4 min-w-max">
          {METRIC_TABS.map((tab) => {
            const active = tab.value === activeMetric;
            return (
              <li key={tab.value}>
                <Link
                  href={buildHref(basePath, activeWindow, tab.value)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center px-3 py-2 text-xs whitespace-nowrap rounded-full transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export function isValidWindow(v: unknown): v is LeaderboardWindow {
  return v === 'today' || v === 'this_week' || v === 'this_month';
}

export function isValidMetric(v: unknown): v is LeaderboardMetric {
  return (
    v === 'composite' ||
    v === 'revenue' ||
    v === 'visits' ||
    v === 'quotations' ||
    v === 'orders' ||
    v === 'conversion_pct' ||
    v === 'task_completion_pct'
  );
}
