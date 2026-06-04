// =============================================================================
// Graphs — chart theming
// =============================================================================
//
// One stable palette used across the 6 charts so the same metric reads
// the same colour wherever it appears. Hex values mirror Tailwind /
// shadcn tokens that are already in use elsewhere in the app.
//
// We intentionally do not pull from CSS custom properties for chart
// fills — recharts paints onto raw SVG attributes which can't resolve
// `var(--md-primary)`. The hexes below match the Deep Teal #006A63
// brand palette as of HVA-201 + HVA-117.
// =============================================================================

export const CHART_PALETTE = {
  primary: '#0F766E', // brand teal — revenue, hero series
  secondary: '#F97316', // amber — visits / counts
  tertiary: '#8B5CF6', // violet — conversion / quality
  success: '#10B981', // emerald — orders / wins
  warn: '#F59E0B', // amber-deep — caution buckets
  rose: '#F43F5E', // rose — funnel terminal stage
  slate: '#64748B', // muted reference line
};

/** Sequential palette for charts that need N distinct hues
 *  (pie/donut share, status funnel). */
export const CHART_SERIES = [
  CHART_PALETTE.primary,
  CHART_PALETTE.secondary,
  CHART_PALETTE.tertiary,
  CHART_PALETTE.success,
  CHART_PALETTE.warn,
  CHART_PALETTE.rose,
  '#0EA5E9', // sky
  '#A855F7', // purple
];

/** Tooltip + axis styling shared by all charts. Kept in one place so
 *  swapping themes is one edit. */
export const CHART_STYLES = {
  axis: {
    stroke: 'rgba(100, 116, 139, 0.35)',
    tick: { fontSize: 11, fill: 'rgba(100, 116, 139, 0.85)' },
  },
  grid: {
    stroke: 'rgba(100, 116, 139, 0.18)',
    strokeDasharray: '3 4',
  },
  tooltip: {
    contentStyle: {
      borderRadius: 12,
      border: '1px solid rgba(100, 116, 139, 0.25)',
      background: 'var(--popover, #ffffff)',
      color: 'var(--popover-foreground, #0f172a)',
      fontSize: 12,
      padding: '8px 10px',
      boxShadow:
        '0 8px 24px -8px rgba(15, 23, 42, 0.15), 0 4px 8px -4px rgba(15, 23, 42, 0.08)',
    },
    cursor: { fill: 'rgba(15, 118, 110, 0.06)' },
  },
};

/** "Tue, Jun 4" style short label for the X-axis. */
export function formatShortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
  });
}

/** "Jun 4" — used when space is tight (mobile / many ticks). */
export function formatTickDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

/** Currency in lakh / crore shorthand for tooltips + axis labels. */
export function formatPaiseShort(paise: number): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Full currency for tooltip header. */
export function formatPaiseFull(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? '-' : '';
  return `${sign}${new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.abs(rupees))}`;
}
