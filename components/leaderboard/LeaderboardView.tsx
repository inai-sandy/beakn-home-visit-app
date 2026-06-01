import { DateRangePicker } from '@/app/(captain)/captain/dashboard/_components/DateRangePicker';
import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Icon } from '@/components/ui/icon';
import { formatRupees } from '@/components/today/DayCloseMetricTiles';
import type { DateFilter } from '@/lib/captain/dashboard-queries';
import type {
  LeaderboardMetric,
  LeaderboardRow,
  LeaderboardWindow,
} from '@/lib/leaderboard/queries';
import { cn } from '@/lib/utils';

import { LeaderboardMetricTabs, METRIC_TABS } from './LeaderboardTabs';

// =============================================================================
// HVA-201: shared leaderboard view used by exec / captain / admin pages
// =============================================================================

interface Props {
  rows: LeaderboardRow[];
  /** Currently-viewing user's exec id. Drives the highlighted "you" row
   *  + the floating below-top-10 row. Captain/admin viewers pass null. */
  viewerExecUserId: string | null;
  activeMetric: LeaderboardMetric;
  activeWindow: LeaderboardWindow;
  basePath: string;
  /** Pass through any other query params (date / from / to) so metric tab
   *  switches don't drop the date filter. */
  preservedQuery: Record<string, string>;
}

const TOP_VISIBLE = 10;

export function LeaderboardView({
  rows,
  viewerExecUserId,
  activeMetric,
  activeWindow,
  basePath,
  preservedQuery,
}: Props) {
  const metricLabel =
    METRIC_TABS.find((t) => t.value === activeMetric)?.label ?? activeMetric;

  const viewerRow = viewerExecUserId
    ? rows.find((r) => r.execUserId === viewerExecUserId) ?? null
    : null;
  const viewerInTop = viewerRow
    ? rows.indexOf(viewerRow) < TOP_VISIBLE
    : false;

  const topRows = rows.slice(0, TOP_VISIBLE);

  // DateRangePicker expects DateFilter — same shape as LeaderboardWindow.
  const datePickerFilter: DateFilter =
    activeWindow.mode === 'single'
      ? { mode: 'single', date: activeWindow.date }
      : { mode: 'range', from: activeWindow.from, to: activeWindow.to };

  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        {/* Header: title + window picker on one row */}
        <header className="pt-5 pb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              Leaderboard
            </h1>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              Ranked by <span className="font-medium">{metricLabel}</span> ·{' '}
              {formatWindowLabel(activeWindow)}
            </p>
          </div>
          <div className="shrink-0">
            <DateRangePicker filter={datePickerFilter} pathname={basePath} />
          </div>
        </header>

        {/* Metric chips */}
        <div className="pb-4">
          <LeaderboardMetricTabs
            basePath={basePath}
            activeMetric={activeMetric}
            preservedQuery={preservedQuery}
          />
        </div>

        {/* Ranked list */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center">
            <Icon
              name="leaderboard"
              size="lg"
              className="text-muted-foreground/60 mx-auto"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              No active sales executives yet.
            </p>
          </div>
        ) : (
          <>
            <ul className="rounded-2xl border bg-card divide-y overflow-hidden">
              {topRows.map((row) => (
                <li key={row.execUserId}>
                  <Row
                    row={row}
                    metric={activeMetric}
                    isViewer={row.execUserId === viewerExecUserId}
                  />
                </li>
              ))}
            </ul>

            {viewerRow && !viewerInTop && (
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground text-center mb-2">
                  Your rank
                </p>
                <ul className="rounded-2xl border-2 border-primary/40 bg-primary/5 overflow-hidden">
                  <li>
                    <Row row={viewerRow} metric={activeMetric} isViewer />
                  </li>
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// =============================================================================
// Row
// =============================================================================

const TOP_3_MEDAL: Record<number, string> = {
  1: 'bg-amber-400 text-amber-950',
  2: 'bg-slate-300 text-slate-900',
  3: 'bg-orange-400 text-orange-950',
};

function Row({
  row,
  metric,
  isViewer,
}: {
  row: LeaderboardRow;
  metric: LeaderboardMetric;
  isViewer: boolean;
}) {
  const medalCls = TOP_3_MEDAL[row.rank];

  return (
    <div
      className={cn(
        'h-16 px-4 flex items-center gap-3',
        isViewer && 'bg-primary/10',
      )}
    >
      {/* Rank pill — fixed width keeps rows perfectly aligned */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold tabular-nums shrink-0',
          medalCls ?? 'bg-muted text-muted-foreground',
        )}
      >
        {row.rank}
      </div>

      {/* Avatar + name + city */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <LeadAvatar name={row.fullName} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate leading-tight">
            {isViewer ? (
              <>
                You{' '}
                <span className="text-muted-foreground font-normal">
                  · {row.fullName}
                </span>
              </>
            ) : (
              row.fullName
            )}
          </p>
          <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
            {row.cityName ?? '—'}
            {row.captainName && ` · ${row.captainName}`}
          </p>
        </div>
      </div>

      {/* Metric value */}
      <p className="text-sm font-semibold tabular-nums shrink-0 text-right truncate max-w-[35%]">
        {formatMetricValue(metric, row.metricValue)}
      </p>
    </div>
  );
}

function formatMetricValue(
  metric: LeaderboardMetric,
  value: number | null,
): string {
  if (value === null) return '—';
  if (metric === 'revenue') return formatRupees(value);
  if (metric === 'conversion_pct' || metric === 'task_completion_pct') {
    return `${Math.round(value)}%`;
  }
  if (metric === 'composite') return value.toFixed(1);
  return Math.round(value).toString();
}

function formatWindowLabel(window: LeaderboardWindow): string {
  if (window.mode === 'single') {
    return formatIstDate(window.date);
  }
  return `${formatIstDate(window.from)} – ${formatIstDate(window.to)}`;
}

function formatIstDate(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
