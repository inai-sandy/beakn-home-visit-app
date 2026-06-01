import Link from 'next/link';

import { cn } from '@/lib/utils';

import type { LeaderboardMetric } from '@/lib/leaderboard/queries';

// HVA-201: URL-driven metric tab strip. The time window now lives on the
// shared <DateRangePicker> (single-date OR from→to range) so this file
// only handles the metric selector.

export const METRIC_TABS: { value: LeaderboardMetric; label: string }[] = [
  { value: 'composite', label: 'Beakn Score' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'visits', label: 'Visits' },
  { value: 'quotations', label: 'Quotations' },
  { value: 'orders', label: 'Orders' },
  { value: 'conversion_pct', label: 'Conversion %' },
  { value: 'task_completion_pct', label: 'Task %' },
];

interface MetricTabsProps {
  basePath: string;
  activeMetric: LeaderboardMetric;
  /** Pass through any other query params (date / from / to) so the user
   *  doesn't lose the date filter when switching metric. */
  preservedQuery: Record<string, string>;
}

export function LeaderboardMetricTabs({
  basePath,
  activeMetric,
  preservedQuery,
}: MetricTabsProps) {
  return (
    <nav aria-label="Metric" className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
      <ul className="flex items-center gap-2 min-w-max pb-1">
        {METRIC_TABS.map((tab) => {
          const active = tab.value === activeMetric;
          const sp = new URLSearchParams(preservedQuery);
          if (tab.value !== 'composite') sp.set('metric', tab.value);
          const qs = sp.toString();
          const href = qs.length > 0 ? `${basePath}?${qs}` : basePath;
          return (
            <li key={tab.value}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center px-3.5 py-1.5 text-xs font-medium whitespace-nowrap rounded-full transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
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
