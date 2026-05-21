import { Badge } from '@/components/ui/badge';
import type { DayCloseMetrics, TargetCell } from '@/lib/today/metrics';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-167: 6-metric traffic-light tile grid (extracted from CloseDayView)
// =============================================================================
//
// Presentational. No client state, no hooks. Reusable by:
//   - app/(exec)/today/close — single-day mode, traffic lights ON
//   - app/(captain)/captain/team/[execId] — single OR range; range mode
//     hides the lights per dashboard convention (HVA-80 D3)
//
// `mode='single'` forces traffic lights ON (each TargetCell decides via
// `cell.status`). `mode='range'` uniformly suppresses the dots — for an
// aggregated window the per-tile target-hit signal isn't meaningful.
//
// `MetricTile` + `StatusDot` were previously private helpers inside
// CloseDayView.tsx. Lifted verbatim so the close-day visual stays
// byte-identical.
// =============================================================================

function StatusDot({ status }: { status: TargetCell['status'] }) {
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

function MetricTile({
  label,
  cell,
  formatActual,
  hideTrafficLight,
}: {
  label: string;
  cell: TargetCell;
  formatActual: (n: number) => string;
  hideTrafficLight: boolean;
}) {
  const actualText = cell.actual === null ? '—' : formatActual(cell.actual);
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {hideTrafficLight ? null : cell.status === 'no_target' ? (
          <Badge variant="outline" className="text-[10px]">
            No target
          </Badge>
        ) : (
          <StatusDot status={cell.status} />
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight">{actualText}</p>
      {cell.target !== null && cell.status !== 'no_target' && !hideTrafficLight && (
        <p className="text-[11px] text-muted-foreground">
          Target {formatActual(cell.target)}
        </p>
      )}
    </div>
  );
}

function formatInteger(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function formatRupees(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

function formatPercent(p: number): string {
  return `${Math.round(p)}%`;
}

interface DayCloseMetricTilesProps {
  metrics: DayCloseMetrics;
  /** 'single' shows per-cell traffic lights; 'range' suppresses them. */
  mode?: 'single' | 'range';
}

export function DayCloseMetricTiles({
  metrics,
  mode = 'single',
}: DayCloseMetricTilesProps) {
  const { targets } = metrics;
  const hide = mode === 'range';
  return (
    <section aria-label="Daily targets" className="grid grid-cols-2 gap-3">
      <MetricTile
        label="Revenue"
        cell={targets.revenue}
        formatActual={formatRupees}
        hideTrafficLight={hide}
      />
      <MetricTile
        label="Visits"
        cell={targets.visits}
        formatActual={formatInteger}
        hideTrafficLight={hide}
      />
      <MetricTile
        label="Quotations"
        cell={targets.quotations}
        formatActual={formatInteger}
        hideTrafficLight={hide}
      />
      <MetricTile
        label="Orders closed"
        cell={targets.orders}
        formatActual={formatInteger}
        hideTrafficLight={hide}
      />
      <MetricTile
        label="Conversion"
        cell={targets.conversionPct}
        formatActual={formatPercent}
        hideTrafficLight={hide}
      />
      <MetricTile
        label="Tasks done"
        cell={targets.taskCompletionPct}
        formatActual={formatPercent}
        hideTrafficLight={hide}
      />
    </section>
  );
}

// Re-export the local format helpers so consumers that need to render a
// single number in the same style (e.g. the captain Weekly Report card)
// can reuse them without re-implementing.
export { formatInteger, formatRupees, formatPercent };
