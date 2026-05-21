import { DayCloseMetricTiles } from '@/components/today/DayCloseMetricTiles';

import type { ExecDayCloseData } from '@/lib/captain/exec-drill-queries';

// =============================================================================
// HVA-167: Day Closure report on the drill-down
// =============================================================================
//
// Single mode → DayCloseMetricTiles with traffic lights ON.
// Range mode  → DayCloseMetricTiles with traffic lights OFF; sub-heading
// reports how many days had a plan submitted in the window.
// =============================================================================

interface Props {
  data: ExecDayCloseData;
}

export function DayCloseReportSection({ data }: Props) {
  if (data.mode === 'single') {
    if (!data.metrics) {
      return (
        <section
          aria-label="Day closure"
          className="rounded-2xl border bg-card p-4 space-y-2"
        >
          <header className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">
              Day Closure
            </h2>
          </header>
          <p className="text-sm text-muted-foreground">
            No plan submitted for this date.
          </p>
        </section>
      );
    }
    return (
      <section aria-label="Day closure" className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Day Closure</h2>
        <DayCloseMetricTiles metrics={data.metrics} mode="single" />
      </section>
    );
  }

  // Range mode — metrics is non-null (EMPTY_METRICS when window is dry).
  return (
    <section aria-label="Day closure" className="space-y-2">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight">
          Day Closure (aggregated)
        </h2>
        <p className="text-xs text-muted-foreground">
          {data.daysWithPlan}/{data.daysInWindow} days had a submitted plan
        </p>
      </header>
      {data.metrics && (
        <DayCloseMetricTiles metrics={data.metrics} mode="range" />
      )}
    </section>
  );
}
