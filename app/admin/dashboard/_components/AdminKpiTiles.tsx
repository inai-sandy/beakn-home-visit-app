import { Icon } from '@/components/ui/icon';

import type { AdminGlobalMetrics } from '@/lib/admin/dashboard-queries';
import { cn } from '@/lib/utils';

import { computeDelta, formatHours, type Delta } from './format';

// =============================================================================
// HVA-117 redesign: 4-tile KPI strip
// =============================================================================
//
// Visits / Orders / Conversion% / Productive minutes — the operational
// pulse of the field team in a single horizontal strip. Each tile has:
//   - tone-coloured icon top-left
//   - small uppercase label
//   - large tabular-nums value
//   - delta chip (vs yesterday)
//
// Collapses to 2-col on tablets, 1-col stack on phones. The 4-tile
// layout is the "wow" version at lg+ — 4 numbers visible without
// scrolling, like a fintech ops console.
// =============================================================================

interface Props {
  today: AdminGlobalMetrics;
  yesterday: AdminGlobalMetrics;
}

interface TileSpec {
  label: string;
  icon: string;
  iconTone: string;
  value: string;
  delta: Delta;
}

export function AdminKpiTiles({ today, yesterday }: Props) {
  const tiles: TileSpec[] = [
    {
      label: 'Visits',
      icon: 'directions_walk',
      iconTone: 'text-sky-600 dark:text-sky-300 bg-sky-500/10',
      value: String(today.visitsToday),
      delta: computeDelta(today.visitsToday, yesterday.visitsToday),
    },
    {
      label: 'Orders',
      icon: 'shopping_bag',
      iconTone: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10',
      value: String(today.completedOrdersToday),
      delta: computeDelta(
        today.completedOrdersToday,
        yesterday.completedOrdersToday,
      ),
    },
    {
      label: 'Conversion',
      icon: 'donut_small',
      iconTone: 'text-violet-600 dark:text-violet-300 bg-violet-500/10',
      value:
        today.conversionPct === null ? '—' : `${today.conversionPct}%`,
      delta: computeDelta(
        today.conversionPct,
        yesterday.conversionPct,
        'pp',
      ),
    },
    {
      label: 'Productive',
      icon: 'schedule',
      iconTone: 'text-amber-600 dark:text-amber-300 bg-amber-500/10',
      value: formatHours(today.productiveMinutesToday),
      delta: computeDelta(
        today.productiveMinutesToday,
        yesterday.productiveMinutesToday,
      ),
    },
  ];

  return (
    <section aria-label="Today's metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {tiles.map((t) => (
        <Tile key={t.label} spec={t} />
      ))}
    </section>
  );
}

function Tile({ spec }: { spec: TileSpec }) {
  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm transition-colors hover:bg-accent/30">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0',
            spec.iconTone,
          )}
          aria-hidden
        >
          <Icon name={spec.icon} size="sm" />
        </span>
        <DeltaPill delta={spec.delta} />
      </div>
      <p className="mt-4 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        {spec.label}
      </p>
      <p className="mt-0.5 text-2xl sm:text-3xl font-bold tabular-nums tracking-tight truncate">
        {spec.value}
      </p>
    </div>
  );
}

function DeltaPill({ delta }: { delta: Delta }) {
  if (delta.direction === 'flat') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
        <Icon name="remove" size="xs" />
        <span className="hidden sm:inline">—</span>
      </span>
    );
  }
  const isUp = delta.direction === 'up';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shrink-0',
        isUp
          ? 'text-emerald-700 dark:text-emerald-300'
          : 'text-rose-700 dark:text-rose-300',
      )}
    >
      <Icon name={isUp ? 'arrow_upward' : 'arrow_downward'} size="xs" />
      {delta.display}
    </span>
  );
}
