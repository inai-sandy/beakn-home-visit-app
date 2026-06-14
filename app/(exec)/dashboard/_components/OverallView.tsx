import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { MetricTileGrid } from "@/components/dashboard/MetricTileGrid";
import { ExecTargetCard } from "@/components/targets/ExecTargetCard";

import type { DateFilter } from "@/lib/captain/dashboard-queries";
import type { MetricKey } from "@/lib/metrics/types";
import type {
  ExecTargetProgress,
  TargetMonthWindow,
} from "@/lib/exec/target-progress";

// =============================================================================
// HVA-290: exec dashboard — Overall tab
// =============================================================================
//
// Financial-year-to-date analytics. Warnings + target pinned at the top
// (Sandeep), then the numbers segregated into collapsible groups so the
// screen stays dense but scannable. Every tile carries its ⓘ explainer
// (via MetricTile) and recomputes for the picked range; Outstanding stays
// pinned "as of today" on a non-today range, other snapshots drop out.
// =============================================================================

const GROUPS: { key: string; title: string; metrics: readonly MetricKey[] }[] = [
  {
    key: "money",
    title: "Revenue & finance",
    metrics: ["revenue", "orders_value", "outstanding"],
  },
  {
    key: "orders",
    title: "Orders & conversion",
    metrics: ["orders_count", "conversion_pct", "quotations_count", "quotations_value"],
  },
  {
    key: "activity",
    title: "Visits & activity",
    metrics: ["visits", "new_requests", "productive_minutes", "cancelled_requests"],
  },
];

interface Props {
  filter: DateFilter;
  rangeLabel: string;
  isTodayRange: boolean;
  values: Partial<Record<MetricKey, number | null>>;
  target: ExecTargetProgress | null;
  monthWindow: TargetMonthWindow;
  warnings: { soft: number; hard: number };
}

export function OverallView({
  filter,
  rangeLabel,
  isTodayRange,
  values,
  target,
  monthWindow,
  warnings,
}: Props) {
  const hasWarnings = warnings.soft > 0 || warnings.hard > 0;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Overall</p>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <DateRangePicker
          filter={filter}
          pathname="/dashboard"
          maxDaysBack={400}
          extraParams={{ view: "overall" }}
        />
      </div>

      {/* Pinned at top: warnings + target. */}
      {hasWarnings && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <Icon name="warning" size="sm" className="text-amber-600" aria-hidden />
          <span className="text-sm font-medium">Active warnings</span>
          {warnings.hard > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {warnings.hard} hard
            </Badge>
          )}
          {warnings.soft > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {warnings.soft} soft
            </Badge>
          )}
        </div>
      )}
      {target && <ExecTargetCard progress={target} window={monthWindow} />}

      <Accordion
        type="multiple"
        defaultValue={GROUPS.map((g) => g.key)}
        className="space-y-3"
      >
        {GROUPS.map((group) => (
          <AccordionItem
            key={group.key}
            value={group.key}
            className="rounded-2xl border bg-card px-4"
          >
            <AccordionTrigger className="text-sm font-semibold">
              {group.title}
            </AccordionTrigger>
            <AccordionContent>
              <MetricTileGrid
                metricKeys={group.metrics}
                values={values}
                isTodayRange={isTodayRange}
                emphasizeFirst
              />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
