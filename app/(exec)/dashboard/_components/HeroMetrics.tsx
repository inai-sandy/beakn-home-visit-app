import { Icon } from '@/components/ui/icon';
import type { DayCloseMetrics } from '@/lib/today/metrics';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-169 D3 — Hero metric tiles
// =============================================================================
//
// Three large numbers (Revenue / Visits / Tasks done) get top billing on
// the dashboard. Visual hierarchy comes from text-3xl + a coloured
// border-l-4 accent stripe; everything else on the page stays at the
// baseline text-xl / text-2xl scale so these read first.
//
// Reads `DayCloseMetrics` directly so the math is the same as the
// /today/close report. Conversion% / Quotations / Orders intentionally
// not part of the hero — they live in the 6-tile DayCloseMetricTiles
// grid below the accordion.
// =============================================================================

function formatRupees(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

interface Props {
  metrics: DayCloseMetrics;
}

export function HeroMetrics({ metrics }: Props) {
  const revenue = metrics.amountCollectedPaise / 100;
  const visits = metrics.targets.visits.actual ?? 0;
  const done = metrics.taskCounts.done;
  return (
    <section
      aria-label="Today's highlights"
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      <HeroTile
        label="Revenue today"
        value={formatRupees(revenue)}
        icon="payments"
        accent="border-l-green-600"
      />
      <HeroTile
        label="Visits completed"
        value={formatCount(visits)}
        icon="location_on"
        accent="border-l-blue-600"
      />
      <HeroTile
        label="Tasks done"
        value={formatCount(done)}
        icon="task_alt"
        accent="border-l-primary"
      />
    </section>
  );
}

function HeroTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: string;
  accent: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border-l-4 border border-l-4 bg-card p-5 shadow-sm',
        'space-y-1.5',
        accent,
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon name={icon} size="sm" aria-hidden />
        <p className="text-xs uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
