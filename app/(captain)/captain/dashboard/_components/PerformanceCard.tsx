import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { PerformanceMetric, TeamPerformance } from '@/lib/captain/dashboard-queries';
import { deltaSign } from '@/lib/captain/dashboard-queries';

// =============================================================================
// HVA-80: Today's Performance card — 6-metric grid with traffic lights + delta
// =============================================================================
//
// Re-uses the locked traffic-light contract from HVA-60 D6:
//   green / yellow / red / no_target (gray pill).
//
// Delta vs yesterday rendered as a small caret + signed value.

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
}: {
  label: string;
  metric: PerformanceMetric;
  format: 'rupees' | 'count' | 'percent';
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {metric.status === 'no_target' ? (
          <Badge variant="outline" className="text-[10px]">
            No target
          </Badge>
        ) : (
          <StatusDot status={metric.status} />
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight">
        {formatActual(format, metric.actual)}
      </p>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        {metric.target !== null && metric.status !== 'no_target' ? (
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
  return (
    <section
      aria-label="Today's performance"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header>
        <h2 className="text-base font-semibold tracking-tight">Today&apos;s Performance</h2>
        <p className="text-xs text-muted-foreground">
          Team aggregate vs yesterday.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Revenue" metric={performance.revenue} format="rupees" />
        <MetricTile label="Visits" metric={performance.visits} format="count" />
        <MetricTile label="Quotations" metric={performance.quotations} format="count" />
        <MetricTile label="Orders" metric={performance.orders} format="count" />
        <MetricTile label="Conversion" metric={performance.conversionPct} format="percent" />
        <MetricTile label="Tasks done" metric={performance.taskCompletionPct} format="percent" />
      </div>
    </section>
  );
}
