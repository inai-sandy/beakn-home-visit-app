import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { cn } from "@/lib/utils";

import type { MetricDefinition } from "@/lib/metrics/registry";
import { formatMetricValue } from "@/lib/dashboard/metric-display";

// =============================================================================
// HVA-289: MetricTile — the one tile every dashboard uses
// =============================================================================
//
// Presentational only. Hand it a metric DEFINITION (from the SSOT
// registry) + the value the loader returned for the current scope/range,
// and it renders a compact, consistent tile:
//
//   [icon] Short label                              (i)
//   ₹1,23,456            ← value (denser than the old hero sizes)
//   Full label            [as of today]
//
// The (i) renders the registry `explainer` verbatim so anyone unsure what
// a number means can read the formula. `asOfNow` adds the badge used when
// a pinned snapshot (Outstanding) shows on a non-today range.
//
// Deliberately NOT oversized (Sandeep: bring the fonts down, fit more
// real information per screen). `emphasis` only nudges a headline tile up
// one step, never to the old 2xl/3xl hero scale.
// =============================================================================

interface MetricTileProps {
  def: MetricDefinition;
  value: number | null;
  /** Show the "as of today" badge (pinned snapshot on a non-today range). */
  asOfNow?: boolean;
  /** Nudge a headline tile (e.g. Revenue) up one size step. */
  emphasis?: boolean;
  className?: string;
}

export function MetricTile({
  def,
  value,
  asOfNow = false,
  emphasis = false,
  className,
}: MetricTileProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3.5 min-w-0",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Icon name={def.icon} size="sm" aria-hidden />
          <span className="truncate text-xs font-medium">
            {def.shortLabel ?? def.label}
          </span>
        </span>
        <InfoTooltip iconOnly>{def.explainer}</InfoTooltip>
      </div>

      <p
        className={cn(
          "mt-1 truncate font-semibold tracking-tight tabular-nums",
          emphasis ? "text-xl" : "text-lg",
        )}
      >
        {formatMetricValue(def.unit, value)}
      </p>

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <p className="text-xs leading-snug text-muted-foreground">
          {def.label}
        </p>
        {asOfNow && (
          <Badge variant="outline" className="text-[10px] font-normal">
            as of today
          </Badge>
        )}
      </div>
    </div>
  );
}
