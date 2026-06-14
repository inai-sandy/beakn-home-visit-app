// =============================================================================
// HVA-289: dashboard metric presentation helpers
// =============================================================================
//
// Pure, UI-agnostic helpers shared by every dashboard surface (exec /
// captain / admin). They never compute a metric — the numbers come from
// the SSOT loaders in lib/metrics. These only decide how to FORMAT a
// value and whether a tile should be SHOWN for the picked date range.
// =============================================================================

import { formatInrFromPaise } from '@/lib/money';
import type { MetricDefinition, MetricUnit } from '@/lib/metrics/registry';

/** Format a metric value for display per its unit. `null` (e.g. conversion
 *  with no visits) renders as an em dash. */
export function formatMetricValue(
  unit: MetricUnit,
  value: number | null,
): string {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case 'paise':
      return formatInrFromPaise(value);
    case 'percent':
      return `${Math.round(value)}%`;
    case 'minutes':
      return formatMinutesShort(value);
    case 'count':
      return value.toLocaleString('en-IN');
  }
}

/** Compact h/m rendering for the productive-minutes tile: 0 → "0m",
 *  45 → "45m", 90 → "1h 30m", 120 → "2h". */
function formatMinutesShort(mins: number): string {
  const safe = Math.max(0, Math.round(mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Whether a metric tile should render for the current date range.
 *
 *  - `range` metrics always render (they recompute for any window).
 *  - `snapshot` metrics are "as of now"; they render only when the range
 *    is today, UNLESS `pinWhenSnapshot` is set (Outstanding receivable),
 *    in which case they always render and the caller shows an
 *    "as of today" badge.
 *
 *  This is the single rule behind "pin Outstanding, hide the other
 *  snapshot tiles when the range isn't today". */
export function isMetricTileVisible(
  def: Pick<MetricDefinition, 'temporality' | 'pinWhenSnapshot'>,
  opts: { isTodayRange: boolean },
): boolean {
  if (def.temporality === 'range') return true;
  return def.pinWhenSnapshot === true || opts.isTodayRange;
}

/** A pinned snapshot tile shown on a non-today range should carry an
 *  "as of today" badge so the number isn't mistaken for a windowed value. */
export function showsAsOfTodayBadge(
  def: Pick<MetricDefinition, 'temporality' | 'pinWhenSnapshot'>,
  opts: { isTodayRange: boolean },
): boolean {
  return (
    def.temporality === 'snapshot' &&
    def.pinWhenSnapshot === true &&
    !opts.isTodayRange
  );
}
