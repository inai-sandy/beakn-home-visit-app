import {
  isMetricTileVisible,
  showsAsOfTodayBadge,
} from "@/lib/dashboard/metric-display";
import { METRIC_DEFINITIONS } from "@/lib/metrics/registry";
import type { MetricKey } from "@/lib/metrics/types";

import { MetricTile } from "./MetricTile";

// =============================================================================
// HVA-290: MetricTileGrid — render a set of registry metrics as tiles
// =============================================================================
//
// Hand it the metric keys for a group + the values the SSOT loader
// returned for the current scope/range + whether the range is "today".
// It filters out snapshot tiles that can't honour a non-today range
// (keeping Outstanding pinned with an "as of today" badge) and lays the
// rest out in a responsive grid. The single place tile-visibility is
// applied so every surface behaves identically.
// =============================================================================

interface Props {
  metricKeys: readonly MetricKey[];
  values: Partial<Record<MetricKey, number | null>>;
  isTodayRange: boolean;
  /** Give the first visible tile a slightly larger value (headline). */
  emphasizeFirst?: boolean;
  className?: string;
}

export function MetricTileGrid({
  metricKeys,
  values,
  isTodayRange,
  emphasizeFirst = false,
  className,
}: Props) {
  const visible = metricKeys.filter((k) =>
    isMetricTileVisible(METRIC_DEFINITIONS[k], { isTodayRange }),
  );
  if (visible.length === 0) return null;

  return (
    <div
      className={
        className ?? "grid grid-cols-2 gap-3 lg:grid-cols-3"
      }
    >
      {visible.map((key, i) => (
        <MetricTile
          key={key}
          def={METRIC_DEFINITIONS[key]}
          value={values[key] ?? null}
          asOfNow={showsAsOfTodayBadge(METRIC_DEFINITIONS[key], {
            isTodayRange,
          })}
          emphasis={emphasizeFirst && i === 0}
        />
      ))}
    </div>
  );
}
