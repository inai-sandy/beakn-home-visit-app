import { Icon } from '@/components/ui/icon';
import type {
  ExecTargetProgress,
  TargetMonthWindow,
} from '@/lib/exec/target-progress';
import { cn } from '@/lib/utils';

// =============================================================================
// ExecTargetCard — Design 2 (twin horizontal bars)
// =============================================================================
//
// For /dashboard (exec). Two stacked progress bars, prominent rupee
// numbers, days-left + pacing chip. Encouraging copy that adapts to
// the current ratio + days remaining.
//
// Per Sandeep 2026-06-02: "this is to be encouraging to them".
// Treatment is positive when on pace, gentle nudge when behind — never
// punishing red.
// =============================================================================

function formatRupeesShort(paise: number): string {
  const rupees = Math.round(paise / 100);
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${rupees}`;
}

function clamp01Plus(v: number): number {
  // Bars cap at 100% width even when over-target (the percentage label
  // still shows the true number).
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

interface PacingMeta {
  label: string;
  tone: 'on-pace' | 'behind' | 'ahead' | 'done';
  iconName: string;
}

/** Per-meter pacing: compare elapsed-month-ratio to progress-ratio.
 *  - on day 1 of a 30-day month, elapsed ratio = 1/30 = 0.033
 *  - exec is "on pace" if their progress ratio >= elapsed ratio
 *  - "ahead" if 1.1× elapsed; "behind" if < 0.7× elapsed
 */
function meterPacing(
  progressRatio: number,
  daysElapsed: number,
  daysInMonth: number,
): PacingMeta {
  if (progressRatio >= 1) {
    return { label: 'Target hit', tone: 'done', iconName: 'celebration' };
  }
  const elapsedRatio = daysElapsed / Math.max(1, daysInMonth);
  if (progressRatio >= elapsedRatio * 1.1) {
    return { label: 'Ahead of pace', tone: 'ahead', iconName: 'trending_up' };
  }
  if (progressRatio >= elapsedRatio * 0.7) {
    return { label: 'On pace', tone: 'on-pace', iconName: 'check_circle' };
  }
  return { label: 'Push needed', tone: 'behind', iconName: 'priority_high' };
}

const TONE_CLASS: Record<PacingMeta['tone'], string> = {
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30',
  ahead:
    'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20',
  'on-pace':
    'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/20',
  behind:
    'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20',
};

const BAR_FILL_CLASS: Record<PacingMeta['tone'], string> = {
  done: 'bg-gradient-to-r from-emerald-500 to-emerald-400',
  ahead: 'bg-gradient-to-r from-emerald-500 to-emerald-400',
  'on-pace': 'bg-gradient-to-r from-sky-500 to-sky-400',
  behind: 'bg-gradient-to-r from-amber-500 to-amber-400',
};

interface Props {
  progress: ExecTargetProgress;
  window: TargetMonthWindow;
}

export function ExecTargetCard({ progress, window }: Props) {
  const daysInMonth = window.daysElapsed + window.daysLeft - 1;
  const ordersPacing = meterPacing(
    progress.ordersRatio,
    window.daysElapsed,
    daysInMonth,
  );
  const revenuePacing = meterPacing(
    progress.revenueRatio,
    window.daysElapsed,
    daysInMonth,
  );

  // Status copy synthesises both meters.
  const bothHit = progress.ordersRatio >= 1 && progress.revenueRatio >= 1;
  const ordersGap = Math.max(0, progress.targetPaise - progress.ordersPaise);
  const revenueGap = Math.max(0, progress.targetPaise - progress.revenuePaise);
  let statusLine: { tone: PacingMeta['tone']; copy: string };
  if (bothHit) {
    statusLine = {
      tone: 'done',
      copy: `${progress.fullName.split(/\s+/u)[0] ?? 'You'}, both targets hit. Outstanding month.`,
    };
  } else if (progress.ordersRatio >= 1) {
    statusLine = {
      tone: 'ahead',
      copy: `Orders locked. ${formatRupeesShort(revenueGap)} of revenue to close the month.`,
    };
  } else if (progress.revenueRatio >= 1) {
    statusLine = {
      tone: 'ahead',
      copy: `Revenue locked. ${formatRupeesShort(ordersGap)} of orders to close the month.`,
    };
  } else if (window.daysLeft <= 7) {
    statusLine = {
      tone: 'behind',
      copy: `${window.daysLeft} day${window.daysLeft === 1 ? '' : 's'} left — push ${formatRupeesShort(Math.min(ordersGap, revenueGap))} on the weaker meter first.`,
    };
  } else if (
    ordersPacing.tone === 'behind' &&
    revenuePacing.tone === 'behind'
  ) {
    statusLine = {
      tone: 'behind',
      copy: `Push ${formatRupeesShort(Math.max(ordersGap, revenueGap))} more this week to get back on pace.`,
    };
  } else {
    statusLine = {
      tone: 'on-pace',
      copy: `${window.daysLeft} day${window.daysLeft === 1 ? '' : 's'} left in ${window.monthLabel}. Keep going.`,
    };
  }

  return (
    <section
      aria-label={`Monthly target — ${window.monthLabel}`}
      className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.07] via-primary/[0.02] to-transparent p-5 sm:p-6"
    >
      {/* Decorative blurred ring */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative space-y-5">
        {/* Header strip */}
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
              {window.monthLabel} target
            </p>
            <p className="text-base font-semibold tracking-tight mt-0.5">
              {formatRupeesShort(progress.targetPaise)} per meter
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-card border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            <Icon name="calendar_today" size="xs" />
            {window.daysLeft} day{window.daysLeft === 1 ? '' : 's'} left
          </span>
        </header>

        {/* Two meters */}
        <div className="space-y-4">
          <Meter
            label="Orders confirmed"
            valuePaise={progress.ordersPaise}
            targetPaise={progress.targetPaise}
            ratio={progress.ordersRatio}
            pacing={ordersPacing}
            iconName="shopping_bag"
          />
          <Meter
            label="Revenue collected"
            valuePaise={progress.revenuePaise}
            targetPaise={progress.targetPaise}
            ratio={progress.revenueRatio}
            pacing={revenuePacing}
            iconName="payments"
          />
        </div>

        {/* Status line — encouraging copy adapts to position. */}
        <div
          className={cn(
            'rounded-2xl px-4 py-3 flex items-center gap-3',
            TONE_CLASS[statusLine.tone],
          )}
        >
          <Icon
            name={
              statusLine.tone === 'done'
                ? 'celebration'
                : statusLine.tone === 'behind'
                  ? 'rocket_launch'
                  : 'auto_awesome'
            }
            size="sm"
            className="shrink-0"
          />
          <p className="text-sm font-medium min-w-0">{statusLine.copy}</p>
        </div>
      </div>
    </section>
  );
}

function Meter({
  label,
  valuePaise,
  targetPaise,
  ratio,
  pacing,
  iconName,
}: {
  label: string;
  valuePaise: number;
  targetPaise: number;
  ratio: number;
  pacing: PacingMeta;
  iconName: string;
}) {
  const filledPct = clamp01Plus(ratio) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            name={iconName}
            size="xs"
            className="text-muted-foreground shrink-0"
          />
          <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            {label}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0 text-[10px] font-semibold shrink-0',
              TONE_CLASS[pacing.tone],
            )}
          >
            <Icon name={pacing.iconName} size="xs" />
            {pacing.label}
          </span>
        </div>
        <p className="text-sm tabular-nums text-muted-foreground">
          <span className="font-bold text-foreground">
            {formatRupeesShort(valuePaise)}
          </span>{' '}
          / {formatRupeesShort(targetPaise)}{' '}
          <span className="text-foreground/60">· {pct(ratio)}%</span>
        </p>
      </div>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct(ratio)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${pct(ratio)} percent of target`}
      >
        <div
          className={cn(
            'h-full transition-all',
            BAR_FILL_CLASS[pacing.tone],
          )}
          style={{ width: `${filledPct}%` }}
        />
      </div>
    </div>
  );
}
