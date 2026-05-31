import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Icon } from '@/components/ui/icon';
import { formatRupees } from '@/components/today/DayCloseMetricTiles';
import type {
  LeaderboardMetric,
  LeaderboardRow,
  LeaderboardWindow,
} from '@/lib/leaderboard/queries';
import { cn } from '@/lib/utils';

import {
  LeaderboardMetricTabs,
  LeaderboardTimeTabs,
  METRIC_TABS,
} from './LeaderboardTabs';

// =============================================================================
// HVA-201: shared leaderboard view used by exec / captain / admin pages
// =============================================================================
//
// Server component. Receives the ranked rows + the viewer's exec id (so we
// can highlight their row) + the active metric/window for tab state + the
// route basePath so tab links resolve correctly per portal
// (/leaderboard, /captain/leaderboard, /admin/leaderboard).
// =============================================================================

interface Props {
  rows: LeaderboardRow[];
  /** Currently-viewing user's exec id. Drives the highlighted "you" row +
   *  the floating below-top-10 row. Captain/admin viewers pass null. */
  viewerExecUserId: string | null;
  activeMetric: LeaderboardMetric;
  activeWindow: LeaderboardWindow;
  basePath: string;
}

const TOP_VISIBLE = 10;

export function LeaderboardView({
  rows,
  viewerExecUserId,
  activeMetric,
  activeWindow,
  basePath,
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

  return (
    <div className="min-h-svh bg-background pb-16">
      <header className="mx-auto max-w-2xl px-4 sm:px-6 pt-5 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Ranked by <span className="font-medium">{metricLabel}</span> across
          all Beakn sales executives.
        </p>
      </header>

      <LeaderboardTimeTabs
        basePath={basePath}
        activeWindow={activeWindow}
        activeMetric={activeMetric}
      />
      <LeaderboardMetricTabs
        basePath={basePath}
        activeWindow={activeWindow}
        activeMetric={activeMetric}
      />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-4">
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
              <>
                <div className="mt-4 mb-2 text-center">
                  <span className="inline-block px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40 rounded-full">
                    Your rank
                  </span>
                </div>
                <ul className="rounded-2xl border bg-primary/5 border-primary/20 divide-y overflow-hidden">
                  <li>
                    <Row row={viewerRow} metric={activeMetric} isViewer />
                  </li>
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Row component
// =============================================================================

const RANK_MEDAL_CLASS: Record<number, string> = {
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
  const medalCls = RANK_MEDAL_CLASS[row.rank];
  return (
    <div
      className={cn(
        'px-4 py-3 flex items-center gap-3',
        isViewer && 'bg-primary/10',
      )}
    >
      {/* Rank badge / medal */}
      <div
        className={cn(
          'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold tabular-nums shrink-0',
          medalCls ?? 'bg-muted text-muted-foreground',
        )}
      >
        {row.rank}
      </div>

      {/* Avatar + name + city */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <LeadAvatar name={row.fullName} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {isViewer ? (
              <>
                You <span className="text-muted-foreground">· {row.fullName}</span>
              </>
            ) : (
              row.fullName
            )}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {row.cityName ?? '—'}
            {row.captainName && ` · ${row.captainName}`}
          </p>
        </div>
      </div>

      {/* Metric value */}
      <p className="text-sm font-semibold tabular-nums shrink-0 text-right min-w-0 max-w-[40%] truncate">
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
