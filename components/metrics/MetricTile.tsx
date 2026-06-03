'use client';

import { useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { formatInrFromPaise } from '@/lib/money';
import type { MetricDefinition } from '@/lib/metrics/registry';
import { cn } from '@/lib/utils';

// =============================================================================
// MetricTile — single SSOT visual for every metric in every portal
// =============================================================================
//
// One component renders every metric, everywhere — admin / captain /
// exec dashboards, city drill, exec target page. The portal supplies
// the definition (from the registry) and the value (from loadMetrics).
// Format is derived from `definition.unit`:
//
//   paise   → INR currency string (₹1,23,456)
//   count   → integer with thousand separators
//   percent → "75%"  /  "—" when value is null (no denominator)
//   minutes → "2h 15m" / "45m"
//
// The ⓘ button opens a calculation explainer popover so anyone can
// see exactly how the number was derived. This is the universal
// info-tile surface Sandeep asked for ("info card for every tile in
// every portal").
// =============================================================================

interface MetricTileProps {
  definition: MetricDefinition;
  value: number | null;
  /** Optional caption (e.g. "this month", "last 30 days") shown
   *  beneath the headline number. */
  caption?: string;
  /** When set, the headline is wrapped in this href so the tile becomes
   *  a navigation entry. */
  href?: string;
  /** Tone variant. `accent` adds a teal-tinted background for hero
   *  tiles; `default` is the plain shadow-elevation card. */
  tone?: 'default' | 'accent';
  className?: string;
}

export function MetricTile({
  definition,
  value,
  caption,
  href,
  tone = 'default',
  className,
}: MetricTileProps) {
  const [infoOpen, setInfoOpen] = useState(false);

  const formatted = formatMetricValue(value, definition);

  const headline = (
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-semibold tabular-nums tracking-tight">
        {formatted}
      </span>
    </div>
  );

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md',
        tone === 'accent'
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon name={definition.icon} size="sm" />
          <span>{definition.shortLabel ?? definition.label}</span>
        </div>
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          aria-label={`How ${definition.label} is calculated`}
          className="rounded-full p-1 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <Icon name="info" size="sm" />
        </button>
      </div>

      <div className="mt-auto">
        {href ? (
          <a href={href} className="block hover:underline">
            {headline}
          </a>
        ) : (
          headline
        )}
        {caption ? (
          <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
        ) : null}
      </div>

      {infoOpen ? (
        <div className="absolute inset-x-3 top-12 z-10 rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg">
          <p className="mb-1 font-medium">{definition.label}</p>
          <p className="text-muted-foreground">{definition.explainer}</p>
        </div>
      ) : null}
    </div>
  );
}

function formatMetricValue(
  value: number | null,
  def: MetricDefinition,
): string {
  if (value === null) return '—';
  switch (def.unit) {
    case 'paise':
      return formatInrFromPaise(value);
    case 'count':
      return new Intl.NumberFormat('en-IN').format(value);
    case 'percent':
      return `${value}%`;
    case 'minutes':
      return formatMinutes(value);
  }
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
