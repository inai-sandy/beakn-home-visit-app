// =============================================================================
// HVA-117 redesign: shared formatters for the admin dashboard
// =============================================================================

/** Compact rupees — no decimals, Indian comma grouping. */
export function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

/** Shortened rupees for hero numbers — ₹12.4L / ₹1.05Cr style. */
export function formatRupeesShort(paise: number): string {
  const rupees = Math.round(paise / 100);
  if (rupees >= 10_000_000) {
    return `₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${(rupees / 100_000).toFixed(2)}L`;
  }
  if (rupees >= 1_000) {
    return `₹${(rupees / 1_000).toFixed(1)}K`;
  }
  return `₹${rupees}`;
}

/** Minutes → "4h 20m" / "45m". */
export function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface Delta {
  direction: DeltaDirection;
  /** Absolute change (positive for up, negative for down). */
  rawDelta: number;
  /** Formatted relative change for display: "+18%" / "−2pp" / "—". */
  display: string;
}

/** Compute a delta between today's and yesterday's value.
 *  When the metric is itself a percentage (e.g. conversion%), pass
 *  `kind: 'pp'` so the display reads "▲ 2pp" instead of "+1%".
 *  When yesterday is 0 and today is non-zero, returns "new" direction up.
 *  When both are 0 (or null), returns flat / "—". */
export function computeDelta(
  today: number | null,
  yesterday: number | null,
  kind: 'pct' | 'pp' | 'count' = 'count',
): Delta {
  if (today === null && yesterday === null) {
    return { direction: 'flat', rawDelta: 0, display: '—' };
  }
  if (today === null) {
    return { direction: 'down', rawDelta: -(yesterday ?? 0), display: '—' };
  }
  if (yesterday === null || yesterday === 0) {
    if (today === 0) return { direction: 'flat', rawDelta: 0, display: '—' };
    return { direction: 'up', rawDelta: today, display: 'new' };
  }
  const raw = today - yesterday;
  if (raw === 0) {
    return { direction: 'flat', rawDelta: 0, display: '—' };
  }
  const direction: DeltaDirection = raw > 0 ? 'up' : 'down';
  if (kind === 'pp') {
    // Percentage-point change for metrics that are themselves percentages.
    const sign = raw > 0 ? '+' : '−';
    return { direction, rawDelta: raw, display: `${sign}${Math.abs(raw)}pp` };
  }
  if (kind === 'pct') {
    // Relative change.
    const pct = Math.round((raw / yesterday) * 100);
    const sign = raw > 0 ? '+' : '−';
    return { direction, rawDelta: raw, display: `${sign}${Math.abs(pct)}%` };
  }
  // Absolute count delta.
  const sign = raw > 0 ? '+' : '−';
  return { direction, rawDelta: raw, display: `${sign}${Math.abs(raw)}` };
}

/** IST-aware greeting based on current hour. */
export function greetingFor(istDate: Date = new Date()): string {
  // toLocaleString with timeZone gives us IST hour directly.
  const istHourStr = istDate.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  });
  const hour = parseInt(istHourStr, 10);
  if (Number.isNaN(hour)) return 'Welcome';
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good evening';
}
