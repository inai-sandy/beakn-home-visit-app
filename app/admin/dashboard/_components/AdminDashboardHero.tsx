import { Icon } from '@/components/ui/icon';

import { cn } from '@/lib/utils';

import { computeDelta, formatRupees, greetingFor } from './format';

// =============================================================================
// HVA-117 redesign: dashboard hero — greeting + revenue spotlight
// =============================================================================
//
// Premium fintech treatment per Sandeep 2026-06-02: huge revenue number
// as the focal point, IST-aware greeting, comparison to yesterday's
// collections with a colour-coded delta chip.
//
// Subtle primary-tinted gradient background so the hero feels "lit"
// vs. the rest of the dashboard's neutral surfaces. No animation —
// premium polish over arcade energy (Sandeep picked the Stripe/Linear
// direction over the arena-style option).
// =============================================================================

interface Props {
  displayName: string;
  /** Net cash received in the picked window (HVA-279: window-driven). */
  collectedPaise: number;
  /** Same metric for the previous same-length window; null when unknown. */
  previousPaise: number | null;
  /** e.g. "vs yesterday" / "vs previous 32 days" — from resolveDateFilter. */
  comparisonLabel: string;
}

export function AdminDashboardHero({
  displayName,
  collectedPaise,
  previousPaise,
  comparisonLabel,
}: Props) {
  const now = new Date();
  const greeting = greetingFor(now);
  const istDateStr = now.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const delta = computeDelta(collectedPaise, previousPaise ?? 0, 'pct');

  const firstName = displayName.split(/\s+/u)[0] ?? displayName;

  return (
    <section
      aria-label="Today's snapshot"
      className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.07] via-primary/[0.02] to-transparent p-6 sm:p-8"
    >
      {/* Decorative ring — soft glow in the top-right corner, doesn't block content */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-0.5 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
              Beakn Command Center
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
              {greeting}, {firstName}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums shrink-0">
            {istDateStr} · IST
          </p>
        </header>

        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            Collected · cash received − refunds
          </p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-4xl sm:text-5xl font-bold tracking-tight tabular-nums">
              {formatRupees(collectedPaise)}
            </p>
            {previousPaise !== null && <DeltaChip delta={delta} />}
          </div>
          {previousPaise !== null && (
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums font-medium">
                {formatRupees(previousPaise)}
              </span>{' '}
              {comparisonLabel}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Delta chip — small coloured pill with arrow + relative change
// -----------------------------------------------------------------------------

function DeltaChip({
  delta,
}: {
  delta: ReturnType<typeof computeDelta>;
}) {
  if (delta.direction === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Icon name="remove" size="xs" />
        no change
      </span>
    );
  }
  const isUp = delta.direction === 'up';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
        isUp
          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
      )}
    >
      <Icon name={isUp ? 'arrow_upward' : 'arrow_downward'} size="xs" />
      {delta.display}
    </span>
  );
}
