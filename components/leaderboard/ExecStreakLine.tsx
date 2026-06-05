import { Icon } from '@/components/ui/icon';
import type { ExecStreakSummary } from '@/lib/leaderboard/streak';

import { StreakBadge } from './StreakBadge';

// =============================================================================
// HVA-201 follow-up: ExecStreakLine — encouragement OR dormancy nudge
// =============================================================================
//
// Three states:
//
//   1. streakDays > 0
//      → "You've been active for N consecutive days. Keep it going."
//      → 🔥 StreakBadge on the right
//
//   2. streakDays === 0 AND lastActiveDay != null
//      → "0 days — last active May 19. Time to get back to work."
//      → Subtle dim slate badge on the right
//      → Helps the exec understand why no flame is showing.
//
//   3. streakDays === 0 AND lastActiveDay === null
//      → Render nothing. Truly new exec or fully dormant — no
//      productive nudge to give.
// =============================================================================

interface Props {
  summary: ExecStreakSummary;
}

function formatIstDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function daysSince(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.floor((todayUtc - t) / 86_400_000);
}

export function ExecStreakLine({ summary }: Props) {
  const { days, lastActiveDay } = summary;

  if (days > 0) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-3">
        <p className="text-[12px] text-muted-foreground">
          You&apos;ve been active for{' '}
          <span className="font-semibold text-foreground">
            {days} consecutive day{days === 1 ? '' : 's'}
          </span>
          . Keep it going.
        </p>
        <StreakBadge days={days} variant="lg" />
      </div>
    );
  }

  if (lastActiveDay) {
    const gap = daysSince(lastActiveDay);
    const tone =
      gap > 7
        ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20'
        : gap > 3
          ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20'
          : 'bg-card';
    return (
      <div
        className={`flex items-center justify-between gap-2 rounded-2xl border p-3 ${tone}`}
      >
        <p className="text-[12px] text-muted-foreground">
          <span className="font-semibold text-foreground">No active streak.</span>{' '}
          Last visit completed on{' '}
          <span className="font-medium text-foreground">
            {formatIstDate(lastActiveDay)}
          </span>{' '}
          ({gap} day{gap === 1 ? '' : 's'} ago). Time to get back to it.
        </p>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          aria-label="0-day streak"
          title="0-day streak"
        >
          <Icon name="local_fire_department" size="xs" />0
        </span>
      </div>
    );
  }

  return null;
}
