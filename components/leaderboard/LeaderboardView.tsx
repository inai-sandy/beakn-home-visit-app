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
// HVA-201 arena redesign: dark + neon esports-style leaderboard
// =============================================================================
//
// This page intentionally overrides the user's global theme — we use a
// fixed dark midnight palette regardless of System/Light/Dark choice in
// /profile. The leaderboard is meant to feel like a competition surface,
// not a settings page.
//
// Top 3 get gold/silver/bronze gradient backgrounds + glow rings + bigger
// rank treatment. #1 has a subtle pulse animation. Each row carries a
// delta arrow vs the prior comparable period.

interface Props {
  rows: LeaderboardRow[];
  viewerExecUserId: string | null;
  activeMetric: LeaderboardMetric;
  activeWindow: LeaderboardWindow;
  basePath: string;
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

  const datePickerFilter: DateFilter =
    activeWindow.mode === 'single'
      ? { mode: 'single', date: activeWindow.date }
      : { mode: 'range', from: activeWindow.from, to: activeWindow.to };

  return (
    // Outer wrapper forces dark theme + adds the atmospheric background
    // gradient. Uses inline `dark` class so this page renders dark mode
    // regardless of the user's global theme preference.
    <div className="dark">
      <main
        className={cn(
          'min-h-svh pb-16 relative overflow-hidden',
          // Multi-stop gradient: deep midnight at top → faint teal glow
          // mid → midnight at bottom. The radial glow gives it the
          // "arena spotlight" feel.
          'bg-[radial-gradient(ellipse_at_top,#1a2845_0%,#0a0e1a_55%,#05070d_100%)]',
          'text-slate-100',
        )}
      >
        {/* Subtle grid overlay for texture */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative mx-auto max-w-2xl px-4 sm:px-6">
          {/* Hero header */}
          <header className="pt-8 pb-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/70 font-semibold mb-1.5">
                  ★ Live Rankings
                </p>
                <h1 className="text-4xl font-black tracking-tight leading-none">
                  <span className="bg-gradient-to-r from-amber-300 via-rose-300 to-cyan-300 bg-clip-text text-transparent">
                    LEADERBOARD
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-2 truncate">
                  Ranked by{' '}
                  <span className="text-cyan-300 font-medium">
                    {metricLabel}
                  </span>{' '}
                  · {formatWindowLabel(activeWindow)}
                </p>
              </div>
              <div className="shrink-0">
                <DateRangePicker
                  filter={datePickerFilter}
                  pathname={basePath}
                />
              </div>
            </div>
          </header>

          {/* Metric chips */}
          <div className="pb-5">
            <LeaderboardMetricTabs
              basePath={basePath}
              activeMetric={activeMetric}
              preservedQuery={preservedQuery}
            />
          </div>

          {/* Ranked list */}
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-10 text-center">
              <Icon
                name="leaderboard"
                size="lg"
                className="text-slate-600 mx-auto"
              />
              <p className="mt-3 text-sm text-slate-400">
                No active sales executives yet.
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-2.5">
                {topRows.map((row) => (
                  <li key={row.execUserId}>
                    <ArenaRow
                      row={row}
                      metric={activeMetric}
                      isViewer={row.execUserId === viewerExecUserId}
                    />
                  </li>
                ))}
              </ul>

              {viewerRow && !viewerInTop && (
                <div className="mt-6">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-300/70 font-semibold text-center mb-2">
                    Your Position
                  </p>
                  <ArenaRow row={viewerRow} metric={activeMetric} isViewer />
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// =============================================================================
// Row — atmospheric variants for top 3, plain dark for the rest
// =============================================================================

interface RowProps {
  row: LeaderboardRow;
  metric: LeaderboardMetric;
  isViewer: boolean;
}

function ArenaRow({ row, metric, isViewer }: RowProps) {
  const isTop1 = row.rank === 1;
  const isTop3 = row.rank <= 3;

  // Per-rank theming
  const variant: {
    bg: string;
    border: string;
    rankBg: string;
    rankText: string;
    glow: string;
    label: string;
  } =
    row.rank === 1
      ? {
          bg: 'bg-gradient-to-br from-amber-500/20 via-amber-600/10 to-transparent',
          border: 'border-amber-400/40',
          rankBg: 'bg-gradient-to-br from-amber-300 to-amber-500',
          rankText: 'text-amber-950',
          glow: 'shadow-[0_0_24px_-4px_rgba(251,191,36,0.45)]',
          label: '1ST',
        }
      : row.rank === 2
        ? {
            bg: 'bg-gradient-to-br from-slate-400/15 via-slate-500/5 to-transparent',
            border: 'border-slate-400/30',
            rankBg: 'bg-gradient-to-br from-slate-200 to-slate-400',
            rankText: 'text-slate-900',
            glow: 'shadow-[0_0_18px_-6px_rgba(203,213,225,0.35)]',
            label: '2ND',
          }
        : row.rank === 3
          ? {
              bg: 'bg-gradient-to-br from-orange-500/20 via-orange-600/8 to-transparent',
              border: 'border-orange-400/35',
              rankBg: 'bg-gradient-to-br from-orange-300 to-orange-500',
              rankText: 'text-orange-950',
              glow: 'shadow-[0_0_18px_-6px_rgba(251,146,60,0.35)]',
              label: '3RD',
            }
          : {
              bg: 'bg-slate-900/70',
              border: 'border-slate-800',
              rankBg: 'bg-slate-800',
              rankText: 'text-slate-300',
              glow: '',
              label: `#${row.rank}`,
            };

  return (
    <div
      className={cn(
        'relative rounded-2xl border backdrop-blur-sm transition-colors',
        variant.bg,
        variant.border,
        variant.glow,
        isTop1 && 'leaderboard-pulse',
        isViewer && 'ring-2 ring-cyan-400/60 ring-offset-2 ring-offset-slate-950',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-4',
          // Taller for top-3 (extra visual weight); standard 16-row for the rest
          isTop3 ? 'h-20' : 'h-16',
        )}
      >
        {/* Rank badge / medal */}
        <div
          className={cn(
            'flex flex-col items-center justify-center shrink-0 rounded-xl font-black tabular-nums',
            variant.rankBg,
            variant.rankText,
            isTop3 ? 'w-14 h-14 text-base' : 'w-10 h-10 text-sm',
          )}
        >
          {isTop3 ? (
            <>
              <span className="text-[9px] tracking-widest leading-none">
                {variant.label}
              </span>
              <Icon
                name={
                  row.rank === 1
                    ? 'emoji_events'
                    : row.rank === 2
                      ? 'workspace_premium'
                      : 'military_tech'
                }
                size="xs"
                className="mt-0.5"
              />
            </>
          ) : (
            <span>{row.rank}</span>
          )}
        </div>

        {/* Avatar + name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className={cn(
              'shrink-0 rounded-full',
              isTop3 && 'ring-2 ring-offset-2 ring-offset-slate-950',
              row.rank === 1 && 'ring-amber-400',
              row.rank === 2 && 'ring-slate-300',
              row.rank === 3 && 'ring-orange-400',
            )}
          >
            <LeadAvatar name={row.fullName} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'truncate leading-tight font-semibold',
                isTop3 ? 'text-xs' : 'text-[11px]',
                isViewer ? 'text-cyan-200' : 'text-slate-100',
              )}
            >
              {isViewer ? (
                <>
                  YOU
                  <span className="text-slate-400 font-normal text-xs ml-1.5">
                    · {row.fullName}
                  </span>
                </>
              ) : (
                <span className="uppercase tracking-wide">{row.fullName}</span>
              )}
            </p>
            <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">
              {row.cityName ?? '—'}
              {row.captainName && ` · ${row.captainName}`}
            </p>
          </div>
        </div>

        {/* Metric value + delta */}
        <div className="shrink-0 text-right">
          <p
            className={cn(
              'font-black tabular-nums truncate leading-none',
              isTop1 ? 'text-lg text-amber-200' : isTop3 ? 'text-base text-slate-100' : 'text-xs text-slate-100',
            )}
          >
            {formatMetricValue(metric, row.metricValue)}
          </p>
          <DeltaIndicator delta={row.rankDelta} />
        </div>
      </div>
    </div>
  );
}

function DeltaIndicator({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1 font-medium">
        NEW
      </p>
    );
  }
  if (delta === 0) {
    return (
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1 font-medium flex items-center justify-end gap-0.5">
        <Icon name="remove" size="xs" />
        SAME
      </p>
    );
  }
  if (delta > 0) {
    return (
      <p className="text-[10px] uppercase tracking-wider text-emerald-400 mt-1 font-bold flex items-center justify-end gap-0.5">
        <Icon name="arrow_upward" size="xs" />
        {delta}
      </p>
    );
  }
  return (
    <p className="text-[10px] uppercase tracking-wider text-rose-400 mt-1 font-bold flex items-center justify-end gap-0.5">
      <Icon name="arrow_downward" size="xs" />
      {Math.abs(delta)}
    </p>
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
