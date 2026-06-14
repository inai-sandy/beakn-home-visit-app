import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';

import type { AdminGlobalMetrics } from '@/lib/admin/dashboard-queries';
import type { DrilldownMetric } from '@/lib/admin/kpi-drilldown';
import { METRIC_DEFINITIONS } from '@/lib/metrics/registry';
import type { MetricKey } from '@/lib/metrics/types';
import { cn } from '@/lib/utils';

import { computeDelta, formatRupeesShort, type Delta } from './format';

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
  /** Metrics for the picked window (HVA-279: window-driven). */
  window: AdminGlobalMetrics;
  /** Previous same-length window; null when no comparison exists. */
  compare: AdminGlobalMetrics | null;
  /** HVA-292: the active window's dates, so each tile links to its
   *  drill-down for the same range. */
  range: { fromDate: string; toDate: string };
}

interface TileSpec {
  label: string;
  icon: string;
  iconTone: string;
  value: string;
  delta: Delta;
  /** Explainer for the ⓘ popover. Pulled from METRIC_DEFINITIONS so
   *  every portal shows the same wording for the same metric. */
  explainer: string;
  /** HVA-292: which drill-down this tile opens. */
  metric: DrilldownMetric;
}

export function AdminKpiTiles({ window, compare, range }: Props) {
  const def = (k: MetricKey) => METRIC_DEFINITIONS[k].explainer;
  const flat: Delta = { direction: 'flat', display: '', rawDelta: 0 };
  const tiles: TileSpec[] = [
    {
      label: 'Booked',
      icon: 'sell',
      iconTone: 'text-teal-600 dark:text-teal-300 bg-teal-500/10',
      value: formatRupeesShort(window.bookedPaise),
      delta: compare
        ? computeDelta(window.bookedPaise, compare.bookedPaise)
        : flat,
      explainer: def('orders_value'),
      metric: 'booked',
    },
    {
      label: 'Visits',
      icon: 'directions_walk',
      iconTone: 'text-sky-600 dark:text-sky-300 bg-sky-500/10',
      value: String(window.visits),
      delta: compare ? computeDelta(window.visits, compare.visits) : flat,
      explainer: def('visits'),
      metric: 'visits',
    },
    {
      label: 'Orders',
      icon: 'shopping_bag',
      iconTone: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/10',
      value: String(window.ordersCount),
      delta: compare
        ? computeDelta(window.ordersCount, compare.ordersCount)
        : flat,
      explainer: def('orders_count'),
      metric: 'orders',
    },
    {
      label: 'Conversion',
      icon: 'donut_small',
      iconTone: 'text-violet-600 dark:text-violet-300 bg-violet-500/10',
      value: window.conversionPct === null ? '—' : `${window.conversionPct}%`,
      delta: compare
        ? computeDelta(window.conversionPct, compare.conversionPct, 'pp')
        : flat,
      explainer: def('conversion_pct'),
      metric: 'conversion',
    },
    {
      label: 'New requests',
      icon: 'inbox',
      iconTone: 'text-amber-600 dark:text-amber-300 bg-amber-500/10',
      value: String(window.newRequests),
      delta: compare
        ? computeDelta(window.newRequests, compare.newRequests)
        : flat,
      explainer: def('new_requests'),
      metric: 'newrequests',
    },
  ];

  return (
    <section aria-label="Metrics for the selected dates" className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {tiles.map((t) => (
        <Tile
          key={t.label}
          spec={t}
          href={`/admin/dashboard/${t.metric}?from=${range.fromDate}&to=${range.toDate}`}
        />
      ))}
    </section>
  );
}

function Tile({ spec, href }: { spec: TileSpec; href: string }) {
  // HVA-292: whole card links to the drill-down. The ⓘ button + delta pill
  // sit as an overlay OUTSIDE the <Link> — a button nested in an anchor is
  // invalid HTML and breaks the layout.
  return (
    <div className="relative">
      <Link
        href={href}
        className="block rounded-2xl border bg-card p-4 sm:p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${spec.label} details`}
      >
        <span
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0',
            spec.iconTone,
          )}
          aria-hidden
        >
          <Icon name={spec.icon} size="sm" />
        </span>
        <div className="mt-4 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
          {spec.label}
        </div>
        <p className="mt-0.5 text-2xl sm:text-3xl font-bold tabular-nums tracking-tight truncate">
          {spec.value}
        </p>
      </Link>
      <div className="absolute right-3 top-3 inline-flex items-center gap-1">
        <DeltaPill delta={spec.delta} />
        <InfoTooltip iconOnly>{spec.explainer}</InfoTooltip>
      </div>
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
