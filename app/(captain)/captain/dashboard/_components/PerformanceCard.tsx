import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';

import type { PerformanceMetric, TeamPerformance } from '@/lib/captain/dashboard-queries';
import { deltaSign } from '@/lib/captain/dashboard-queries';

// =============================================================================
// HVA-80 / extension: Today's Performance card — 6-metric grid + traffic lights
// =============================================================================
//
// `performance.showTrafficLights` drives whether status dots render.
// Range mode hides them per locked decision D3 (just numbers, no color).
//
// Delta arrows compare against `performance.previous` and label using
// `performance.comparisonLabel` (e.g. "vs previous day" / "vs previous 7
// days"). Up = green arrow, down = red arrow, equal = no arrow.
// =============================================================================

function formatActual(metric: 'rupees' | 'count' | 'percent', value: number | null): string {
  if (value === null) return '—';
  if (metric === 'rupees') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (metric === 'percent') return `${Math.round(value)}%`;
  return Math.round(value).toLocaleString('en-IN');
}

function StatusDot({ status }: { status: PerformanceMetric['status'] }) {
  const cls =
    status === 'green'
      ? 'bg-green-500'
      : status === 'yellow'
        ? 'bg-yellow-400'
        : status === 'red'
          ? 'bg-red-500'
          : 'bg-muted-foreground/40';
  return <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', cls)} />;
}

function DeltaArrow({
  today,
  previous,
  format,
}: {
  today: number | null;
  previous: number | null;
  format: 'rupees' | 'count' | 'percent';
}) {
  const sign = deltaSign(today, previous);
  if (sign === 'unknown' || sign === 'flat') return null;
  const diff = Math.abs((today ?? 0) - (previous ?? 0));
  const iconName = sign === 'up' ? 'arrow_upward' : 'arrow_downward';
  const cls = sign === 'up' ? 'text-green-600' : 'text-red-600';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px]', cls)}>
      <Icon name={iconName} size="xs" />
      {formatActual(format, diff)}
    </span>
  );
}

function MetricTile({
  label,
  metric,
  format,
  showTrafficLights,
  tooltip,
}: {
  label: string;
  metric: PerformanceMetric;
  format: 'rupees' | 'count' | 'percent';
  showTrafficLights: boolean;
  tooltip: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1 min-w-0 truncate">
          {label}
          <InfoTooltip iconOnly>{tooltip}</InfoTooltip>
        </p>
        {showTrafficLights ? (
          metric.status === 'no_target' ? (
            <Badge variant="outline" className="text-[10px] shrink-0">
              No target
            </Badge>
          ) : (
            <StatusDot status={metric.status} />
          )
        ) : null}
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums truncate">
        {formatActual(format, metric.actual)}
      </p>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {showTrafficLights &&
        metric.target !== null &&
        metric.status !== 'no_target' ? (
          <span>Target {formatActual(format, metric.target)}</span>
        ) : (
          <span className="invisible">—</span>
        )}
        <DeltaArrow today={metric.actual} previous={metric.previous} format={format} />
      </div>
    </div>
  );
}

export function PerformanceCard({ performance }: { performance: TeamPerformance }) {
  const cardTooltip = performance.showTrafficLights
    ? "Today's team performance across 6 metrics. Green = met or exceeded daily target. Yellow = within 70% of target. Red = below 70%. Gray = no target set. Arrows show change from yesterday."
    : 'Aggregated team performance across the selected range. Traffic lights are hidden for ranges. Arrows show change from the previous period of the same length.';

  return (
    <section
      aria-label="Performance"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-1 max-w-full">
          <span className="truncate">
            {performance.showTrafficLights ? "Today's Performance" : 'Performance'}
          </span>
          <InfoTooltip iconOnly>{cardTooltip}</InfoTooltip>
        </h2>
        <p className="text-xs text-muted-foreground truncate">
          {performance.comparisonLabel}.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          label="Revenue"
          metric={performance.revenue}
          format="rupees"
          showTrafficLights={performance.showTrafficLights}
          tooltip="Total amount collected from team members' inbound payments in the selected window."
        />
        <MetricTile
          label="Visits"
          metric={performance.visits}
          format="count"
          showTrafficLights={performance.showTrafficLights}
          tooltip="Completed customer-facing tasks: Customer home visit + Sales pitch + Outlet visit task types."
        />
        <MetricTile
          label="Quotations"
          metric={performance.quotations}
          format="count"
          showTrafficLights={performance.showTrafficLights}
          tooltip="Quotations submitted by team members in the selected window."
        />
        <MetricTile
          label="Orders"
          metric={performance.orders}
          format="count"
          showTrafficLights={performance.showTrafficLights}
          tooltip="Requests that reached Order Confirmed or Order Executed Successfully in the selected window."
        />
        <MetricTile
          label="Conversion"
          metric={performance.conversionPct}
          format="percent"
          showTrafficLights={performance.showTrafficLights}
          tooltip="Orders ÷ Visits × 100. Shows the fraction of visits that became confirmed orders. Null when no visits."
        />
        <MetricTile
          label="Tasks done"
          metric={performance.taskCompletionPct}
          format="percent"
          showTrafficLights={performance.showTrafficLights}
          tooltip="Completed tasks ÷ Total tasks (completed + pending + postponed) × 100."
        />
      </div>
    </section>
  );
}
