import { format, parseISO } from 'date-fns';

import { DayCloseMetricTiles } from '@/components/today/DayCloseMetricTiles';

import type { ExecWeeklyReport } from '@/lib/captain/exec-drill-queries';

// =============================================================================
// HVA-167: Weekly report — always last 7 vs previous 7
// =============================================================================
//
// Independent of the calendar selection (D7). Lets the captain glance
// at a constant week-on-week rhythm regardless of which date they're
// investigating in the day-plan / day-close sections above.
//
// Renders the same tile grid as DayCloseReportSection's range mode,
// with the previous window labelled in the sub-heading. Deltas TBD —
// a future polish ticket could add ↑/↓ arrows; today we just show the
// two windows side by side conceptually (current numbers on the tiles
// + previous window dates in the sub-heading).
// =============================================================================

interface Props {
  data: ExecWeeklyReport;
}

function dateLabel(istDate: string): string {
  const d = parseISO(`${istDate}T00:00:00`);
  return format(d, 'd MMM');
}

export function WeeklyReportCard({ data }: Props) {
  return (
    <section aria-label="Weekly report" className="space-y-2">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight">
          Weekly Report
        </h2>
        <p className="text-xs text-muted-foreground">
          {dateLabel(data.currentWindow.from)}–
          {dateLabel(data.currentWindow.to)} (vs{' '}
          {dateLabel(data.previousWindow.from)}–
          {dateLabel(data.previousWindow.to)})
        </p>
      </header>
      <DayCloseMetricTiles metrics={data.current} mode="range" />
    </section>
  );
}
