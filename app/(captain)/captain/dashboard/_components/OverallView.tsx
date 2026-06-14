import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { MetricTileGrid } from "@/components/dashboard/MetricTileGrid";

import { formatInrFromPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DateFilter } from "@/lib/captain/dashboard-queries";
import type { MetricKey } from "@/lib/metrics/types";
import type { ExecTargetProgress } from "@/lib/exec/target-progress";

// =============================================================================
// HVA-290: captain dashboard — Overall tab
// =============================================================================
//
// The financial-year business picture for the whole team, plus a
// "finish line" per exec — revenue against their monthly target — so the
// captain can see at a glance who's ahead, who's lagging, and who's about
// to cross. Team metrics segregated into collapsible groups; every tile
// carries its ⓘ explainer and honours the date range (Outstanding pinned).
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
    metrics: ["visits", "new_requests", "cancelled_requests"],
  },
];

/** Flat list of every metric the captain Overall tab needs loaded, derived
 *  from the groups so the page's loadMetrics call can't drift from what's
 *  rendered. Shared by /captain/dashboard and the admin portal replica. */
export const CAPTAIN_OVERALL_METRIC_KEYS: readonly MetricKey[] = GROUPS.flatMap(
  (g) => g.metrics,
);

interface Props {
  filter: DateFilter;
  rangeLabel: string;
  isTodayRange: boolean;
  values: Partial<Record<MetricKey, number | null>>;
  execProgress: ExecTargetProgress[];
  monthLabel: string;
  /** Route the date picker pushes into. Defaults to the captain's own
   *  dashboard; the admin portal replica passes its captainId path. */
  pathname?: string;
}

export function OverallView({
  filter,
  rangeLabel,
  isTodayRange,
  values,
  execProgress,
  monthLabel,
  pathname = "/captain/dashboard",
}: Props) {
  // Rank execs by how close they are to their target (highest first).
  const ranked = [...execProgress].sort(
    (a, b) => b.revenueRatio - a.revenueRatio,
  );

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Overall — team</p>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <DateRangePicker
          filter={filter}
          pathname={pathname}
          maxDaysBack={400}
          extraParams={{ view: "overall" }}
        />
      </div>

      <Accordion
        type="multiple"
        defaultValue={[...GROUPS.map((g) => g.key), "targets"]}
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

        {/* Per-exec target finish line — revenue vs monthly target. */}
        <AccordionItem
          value="targets"
          className="rounded-2xl border bg-card px-4"
        >
          <AccordionTrigger className="text-sm font-semibold">
            <InfoTooltip label={`Target finish line · ${monthLabel}`}>
              Each exec&apos;s revenue collected this month against their
              monthly revenue target. The bar fills toward 100%; execs are
              ranked by who is closest to crossing.
            </InfoTooltip>
          </AccordionTrigger>
          <AccordionContent>
            {ranked.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No executives on your team yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {ranked.map((e) => (
                  <FinishLineRow key={e.execUserId} exec={e} />
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function FinishLineRow({ exec }: { exec: ExecTargetProgress }) {
  const pct = Math.round(exec.revenueRatio * 100);
  const reached = exec.revenueRatio >= 1;
  const width = Math.min(100, Math.max(2, pct));
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{exec.fullName}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatInrFromPaise(exec.revenuePaise)} /{" "}
          {formatInrFromPaise(exec.targetPaise)}
          <span
            className={cn(
              "ml-2 font-semibold",
              reached ? "text-emerald-600" : "text-foreground",
            )}
          >
            {pct}%
          </span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            reached ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </li>
  );
}
