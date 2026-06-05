import { Icon } from '@/components/ui/icon';
import { HARD_WARNING_FIRE_THRESHOLD } from '@/lib/warnings/metrics';
import type { ActiveWarningCounts } from '@/lib/warnings/queries';

// =============================================================================
// HVA-229 v2: ExecWarningStats — number-hero pair of cards
// =============================================================================
//
// Sandeep 2026-06-05: *"the pill which we have designed previously we
// have to enhance that. instead we made something which is useless. we
// have to soft/hard warnings number with a good design."*
//
// Two stat cards side by side. Soft on the left (amber), Hard on the
// right (rose). Each shows the count as the hero number with a small
// label below. The hard card also shows the "/5" threshold so the exec
// always knows how close they are to the termination flag.
//
// When 5/5 reached, the hard card switches to filled-rose with white
// type for maximum salience. Soft card stays muted-amber.
//
// Returns null when both counts are zero (clean state — no card).
// =============================================================================

interface Props {
  counts: ActiveWarningCounts;
}

export function ExecWarningStats({ counts }: Props) {
  const { softActive, hardActive, hardThreshold, fireFlag } = counts;
  if (softActive === 0 && hardActive === 0) return null;

  return (
    <section
      aria-label="Active performance warnings"
      className="grid grid-cols-2 gap-3"
    >
      <StatCard
        kind="soft"
        count={softActive}
        threshold={null}
        flag={false}
      />
      <StatCard
        kind="hard"
        count={hardActive}
        threshold={hardThreshold}
        flag={fireFlag}
      />
    </section>
  );
}

function StatCard({
  kind,
  count,
  threshold,
  flag,
}: {
  kind: 'soft' | 'hard';
  count: number;
  threshold: number | null;
  flag: boolean;
}) {
  const dim = count === 0;

  // Tone resolution. `flag` overrides hard styling to a filled-rose
  // alert; otherwise tone scales by kind + dim state.
  const styles = flag
    ? {
        border: 'border-rose-600',
        bg: 'bg-rose-600',
        text: 'text-white',
        sub: 'text-rose-100',
        icon: 'text-white',
        iconBg: 'bg-rose-700/60',
      }
    : kind === 'hard'
      ? dim
        ? {
            border: 'border-border',
            bg: 'bg-card',
            text: 'text-foreground/40',
            sub: 'text-muted-foreground',
            icon: 'text-rose-400/60',
            iconBg: 'bg-rose-100/40 dark:bg-rose-950/20',
          }
        : {
            border: 'border-rose-300 dark:border-rose-700',
            bg: 'bg-rose-50 dark:bg-rose-950/30',
            text: 'text-rose-900 dark:text-rose-100',
            sub: 'text-rose-700/80 dark:text-rose-300/80',
            icon: 'text-rose-600 dark:text-rose-400',
            iconBg: 'bg-rose-100 dark:bg-rose-900/40',
          }
      : dim
        ? {
            border: 'border-border',
            bg: 'bg-card',
            text: 'text-foreground/40',
            sub: 'text-muted-foreground',
            icon: 'text-amber-400/60',
            iconBg: 'bg-amber-100/40 dark:bg-amber-950/20',
          }
        : {
            border: 'border-amber-300 dark:border-amber-700',
            bg: 'bg-amber-50 dark:bg-amber-950/30',
            text: 'text-amber-900 dark:text-amber-100',
            sub: 'text-amber-700/80 dark:text-amber-300/80',
            icon: 'text-amber-600 dark:text-amber-400',
            iconBg: 'bg-amber-100 dark:bg-amber-900/40',
          };

  const iconName = kind === 'hard' ? 'gpp_bad' : 'campaign';
  const label = kind === 'hard' ? 'Hard warning' : 'Soft warning';

  return (
    <article
      className={`rounded-2xl border-2 ${styles.border} ${styles.bg} p-4 sm:p-5 flex items-center gap-3 transition-shadow ${flag ? 'shadow-md ring-2 ring-rose-300/50' : ''}`}
    >
      <span
        className={`grid place-items-center w-10 h-10 rounded-xl shrink-0 ${styles.iconBg} ${styles.icon}`}
        aria-hidden
      >
        <Icon name={iconName} size="sm" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[10px] uppercase tracking-[0.14em] font-semibold ${styles.sub}`}
        >
          {label}
          {count === 1 ? '' : 's'}
        </p>
        <p
          className={`font-black tabular-nums tracking-tight leading-none mt-0.5 ${styles.text} ${kind === 'hard' && threshold !== null ? 'text-[26px] sm:text-[30px]' : 'text-[28px] sm:text-[32px]'}`}
        >
          {count}
          {kind === 'hard' && threshold !== null && (
            <span className={`text-base sm:text-lg font-bold ${styles.sub}`}>
              /{threshold}
            </span>
          )}
        </p>
        {flag && (
          <p className="text-[10px] uppercase tracking-wider font-bold text-white mt-1">
            Eligible for termination
          </p>
        )}
        {!flag && count === 0 && (
          <p className="text-[11px] text-muted-foreground mt-0.5">None</p>
        )}
      </div>
    </article>
  );
}
