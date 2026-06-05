import { MAX_STREAK_DAYS } from '@/lib/leaderboard/streak';

// =============================================================================
// HVA-201: StreakBadge — flame + consecutive-days count
// =============================================================================
//
// Renders only when streakDays >= 1. Tone scales with the count:
//   1-2   → muted orange (just started)
//   3-6   → orange (on a roll)
//   7-13  → amber-yellow (week+)
//   14+   → red-orange + pulse (fire)
//
// Used on the leaderboard arena rows and on the exec dashboard near
// the target card. Variant `lg` is for hero placement (exec dashboard
// card); default is for tight row placements.
// =============================================================================

interface Props {
  days: number;
  variant?: 'default' | 'lg';
}

export function StreakBadge({ days, variant = 'default' }: Props) {
  if (days < 1) return null;

  const tone =
    days >= 14
      ? 'bg-rose-500/20 text-rose-200 border-rose-400/60 ring-1 ring-rose-400/30'
      : days >= 7
        ? 'bg-amber-400/20 text-amber-200 border-amber-400/60'
        : days >= 3
          ? 'bg-orange-500/20 text-orange-200 border-orange-400/60'
          : 'bg-orange-400/10 text-orange-300/90 border-orange-400/40';

  const sizeClass =
    variant === 'lg'
      ? 'text-sm px-2.5 py-1 gap-1'
      : 'text-[10px] px-1.5 py-0.5 gap-0.5';

  const label =
    days >= MAX_STREAK_DAYS ? `${MAX_STREAK_DAYS}+` : String(days);

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold tabular-nums ${tone} ${sizeClass}`}
      aria-label={`Active for ${days} consecutive days`}
      title={`Active for ${days} consecutive day${days === 1 ? '' : 's'}`}
    >
      <span aria-hidden>🔥</span>
      {label}
    </span>
  );
}
