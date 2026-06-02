import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Icon } from '@/components/ui/icon';
import type {
  ExecTargetProgress,
  TargetMonthWindow,
} from '@/lib/exec/target-progress';
import { cn } from '@/lib/utils';

// =============================================================================
// TeamTargetArena — Design 3 (leaderboard-arena style)
// =============================================================================
//
// For /captain/dashboard (team of execs assigned under this captain) +
// /admin/dashboard (every exec, ranked globally). Same component, two
// contexts; the call site passes the pre-filtered + pre-sorted rows.
//
// Each row shows: rank · avatar · name · dual progress bars · combined
// percentage chip. Top-1 gets a subtle gold tint. Optional `viewerExecUserId`
// highlights the viewer's own row (currently unused for captain/admin
// but kept in the signature for symmetry with the leaderboard).
//
// Borrows the visual vocabulary from /leaderboard's arena redesign but
// stays in the *light* theme — this is a dashboard panel, not a full
// arena page.
// =============================================================================

function formatRupeesShort(paise: number): string {
  const rupees = Math.round(paise / 100);
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${rupees}`;
}

function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

function clamp01Plus(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

interface Props {
  rows: ExecTargetProgress[];
  window: TargetMonthWindow;
  /** When set, highlights the matching row + scrolls it into view. */
  viewerExecUserId?: string;
  /** Header label override — defaults to "Team targets". Admin call
   *  site can pass "All executives". */
  title?: string;
}

export function TeamTargetArena({
  rows,
  window,
  viewerExecUserId,
  title = 'Team targets',
}: Props) {
  if (rows.length === 0) {
    return (
      <section
        aria-label={title}
        className="rounded-3xl border bg-card p-6 shadow-sm text-center"
      >
        <Icon
          name="track_changes"
          size="md"
          className="text-muted-foreground/50 mx-auto mb-2"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          No active executives to track for {window.monthLabel}.
        </p>
      </section>
    );
  }

  // Aggregate row for the team — sum across all execs.
  const aggregate = rows.reduce(
    (acc, r) => {
      acc.ordersPaise += r.ordersPaise;
      acc.revenuePaise += r.revenuePaise;
      acc.totalTargetPaise += r.targetPaise;
      return acc;
    },
    { ordersPaise: 0, revenuePaise: 0, totalTargetPaise: 0 },
  );
  const aggregateOrdersRatio =
    aggregate.totalTargetPaise === 0
      ? 0
      : aggregate.ordersPaise / aggregate.totalTargetPaise;
  const aggregateRevenueRatio =
    aggregate.totalTargetPaise === 0
      ? 0
      : aggregate.revenuePaise / aggregate.totalTargetPaise;

  return (
    <section
      aria-label={title}
      className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-5"
    >
      {/* Header with aggregate + days-left chip */}
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
              {window.monthLabel} · {rows.length} exec
              {rows.length === 1 ? '' : 's'}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted border px-2.5 py-0.5 text-[11px] font-medium tabular-nums">
            <Icon name="calendar_today" size="xs" />
            {window.daysLeft} day{window.daysLeft === 1 ? '' : 's'} left
          </span>
        </div>

        {/* Team aggregate bars */}
        <div className="rounded-2xl bg-muted/40 p-3 space-y-2.5">
          <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            Team combined
          </p>
          <AggregateMeter
            label="Orders"
            valuePaise={aggregate.ordersPaise}
            targetPaise={aggregate.totalTargetPaise}
            ratio={aggregateOrdersRatio}
            iconName="shopping_bag"
            barTone="orders"
          />
          <AggregateMeter
            label="Revenue"
            valuePaise={aggregate.revenuePaise}
            targetPaise={aggregate.totalTargetPaise}
            ratio={aggregateRevenueRatio}
            iconName="payments"
            barTone="revenue"
          />
        </div>
      </header>

      {/* Per-exec arena rows */}
      <ol className="space-y-2">
        {rows.map((row, idx) => (
          <ArenaRow
            key={row.execUserId}
            row={row}
            rank={idx + 1}
            isTop={idx === 0}
            isViewer={row.execUserId === viewerExecUserId}
          />
        ))}
      </ol>
    </section>
  );
}

// -----------------------------------------------------------------------------

function AggregateMeter({
  label,
  valuePaise,
  targetPaise,
  ratio,
  iconName,
  barTone,
}: {
  label: string;
  valuePaise: number;
  targetPaise: number;
  ratio: number;
  iconName: string;
  barTone: 'orders' | 'revenue';
}) {
  const filledPct = clamp01Plus(ratio) * 100;
  const fillClass =
    barTone === 'orders'
      ? 'bg-gradient-to-r from-violet-500 to-indigo-400'
      : 'bg-gradient-to-r from-emerald-500 to-teal-400';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <Icon name={iconName} size="xs" />
          {label}
        </span>
        <p className="text-xs tabular-nums">
          <span className="font-bold">{formatRupeesShort(valuePaise)}</span>{' '}
          <span className="text-muted-foreground">
            / {formatRupeesShort(targetPaise)} · {pct(ratio)}%
          </span>
        </p>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-background">
        <div
          className={cn('h-full transition-all', fillClass)}
          style={{ width: `${filledPct}%` }}
          aria-label={`${label}: ${pct(ratio)}%`}
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function ArenaRow({
  row,
  rank,
  isTop,
  isViewer,
}: {
  row: ExecTargetProgress;
  rank: number;
  isTop: boolean;
  isViewer: boolean;
}) {
  const ordersFilled = clamp01Plus(row.ordersRatio) * 100;
  const revenueFilled = clamp01Plus(row.revenueRatio) * 100;
  const combinedPct = pct(row.combinedRatio);

  // Subtle tier styling — gold tint for #1, neutral for #2-5, muted for the rest.
  const tier =
    isTop && row.combinedRatio > 0
      ? 'gold'
      : rank <= 3 && row.combinedRatio > 0
        ? 'medal'
        : 'flat';

  return (
    <li
      className={cn(
        'rounded-2xl border bg-background/60 p-3 transition-colors',
        'flex items-center gap-3',
        tier === 'gold' &&
          'border-amber-500/30 bg-gradient-to-r from-amber-500/[0.07] via-transparent to-transparent',
        isViewer &&
          'border-primary/40 ring-1 ring-primary/10 bg-primary/[0.04]',
      )}
    >
      {/* Rank badge */}
      <div
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold tabular-nums shrink-0',
          tier === 'gold'
            ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-[0_0_12px_-4px_rgba(245,158,11,0.6)]'
            : tier === 'medal'
              ? 'bg-muted text-foreground'
              : 'bg-muted/50 text-muted-foreground',
        )}
      >
        {rank}
      </div>

      <LeadAvatar name={row.fullName} aria-hidden />

      {/* Identity + dual progress */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p
            className={cn(
              'text-sm font-semibold tracking-tight truncate min-w-0',
              isViewer ? 'text-primary' : '',
            )}
          >
            {row.fullName}
            {row.cityNames.length > 0 && (
              <span className="text-[11px] font-normal text-muted-foreground ml-1.5">
                · {row.cityNames.slice(0, 2).join(' · ')}
                {row.cityNames.length > 2 && ` +${row.cityNames.length - 2}`}
              </span>
            )}
          </p>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums shrink-0',
              row.combinedRatio >= 1
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : row.combinedRatio >= 0.7
                  ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : row.combinedRatio >= 0.3
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground',
            )}
          >
            {combinedPct}%
          </span>
        </div>

        {/* Two slim stacked bars */}
        <div className="grid grid-cols-1 gap-1">
          <SlimBar
            label="Orders"
            valuePaise={row.ordersPaise}
            targetPaise={row.targetPaise}
            filledPct={ordersFilled}
            tone="orders"
          />
          <SlimBar
            label="Revenue"
            valuePaise={row.revenuePaise}
            targetPaise={row.targetPaise}
            filledPct={revenueFilled}
            tone="revenue"
          />
        </div>
      </div>
    </li>
  );
}

function SlimBar({
  label,
  valuePaise,
  targetPaise,
  filledPct,
  tone,
}: {
  label: string;
  valuePaise: number;
  targetPaise: number;
  filledPct: number;
  tone: 'orders' | 'revenue';
}) {
  void targetPaise;
  const fillClass =
    tone === 'orders'
      ? 'bg-gradient-to-r from-violet-500 to-indigo-400'
      : 'bg-gradient-to-r from-emerald-500 to-teal-400';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] uppercase tracking-[0.12em] font-semibold text-muted-foreground w-12 shrink-0">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', fillClass)}
          style={{ width: `${filledPct}%` }}
        />
      </div>
      <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-14 text-right shrink-0">
        {formatRupeesShort(valuePaise)}
      </span>
    </div>
  );
}
