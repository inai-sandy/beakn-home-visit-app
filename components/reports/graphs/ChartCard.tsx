import { Icon } from '@/components/ui/icon';

import type { ReactNode } from 'react';

// =============================================================================
// ChartCard — shared shell for every graph card on /reports/graphs
// =============================================================================
//
// Header is a small icon + title + optional subtitle. Body slots the
// chart underneath. Empty state is rendered when `isEmpty` is true so
// every chart degrades the same way.
//
// Layout is intentionally flat (no nested cards) so the children fill
// the available width — recharts' <ResponsiveContainer> needs a sized
// parent.
// =============================================================================

interface Props {
  title: string;
  subtitle?: string;
  icon?: string;
  /** Optional headline number shown on the right of the header — useful
   *  for "Total: ₹1.2L this month" style callouts. */
  badge?: string;
  /** When true the body slot is replaced with the empty state. */
  isEmpty?: boolean;
  emptyHint?: string;
  /** Approximate body height — passed through to a min-h so the chart
   *  has room before recharts measures. */
  bodyMinHeight?: number;
  children: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  icon = 'analytics',
  badge,
  isEmpty = false,
  emptyHint = 'No data yet in the selected window.',
  bodyMinHeight = 280,
  children,
}: Props) {
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
      <header className="flex items-start justify-between gap-3 pb-3 border-b border-border/60">
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className="grid place-items-center w-9 h-9 rounded-xl bg-primary/10 text-primary shrink-0"
            aria-hidden
          >
            <Icon name={icon} size="sm" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {badge && (
          <span className="text-[11px] font-medium text-muted-foreground bg-muted/40 rounded-md px-2 py-1 whitespace-nowrap">
            {badge}
          </span>
        )}
      </header>

      <div
        className="pt-3"
        style={{ minHeight: bodyMinHeight }}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center text-center gap-2 h-full py-10">
            <Icon
              name="bar_chart"
              size="lg"
              className="text-muted-foreground/40"
              aria-hidden
            />
            <p className="text-xs text-muted-foreground max-w-xs">
              {emptyHint}
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
