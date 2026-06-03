import {
  METRIC_DEFINITIONS,
  type LoadMetricsResult,
} from '@/lib/metrics/registry';
import type { MetricKey } from '@/lib/metrics/types';
import { cn } from '@/lib/utils';

import { MetricTile } from './MetricTile';

// =============================================================================
// MetricGrid — render a row of MetricTiles in a responsive grid
// =============================================================================
//
// Convenience wrapper around `MetricTile` for the common case where a
// page needs to display N tiles in a row/grid. Each entry in `tiles`
// references a `MetricKey` plus optional per-tile presentation
// overrides (caption / href / tone).
//
// Layout: 2 columns on mobile, 4 on lg+. Override `columns` to break
// the default (e.g. 3 tiles for a captain hero strip).
// =============================================================================

interface MetricTileSpec<K extends MetricKey> {
  key: K;
  caption?: string;
  href?: string;
  tone?: 'default' | 'accent';
}

interface MetricGridProps<K extends MetricKey> {
  tiles: ReadonlyArray<MetricTileSpec<K>>;
  values: LoadMetricsResult<K>;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

const COLUMN_CLASS: Record<NonNullable<MetricGridProps<MetricKey>['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
};

export function MetricGrid<K extends MetricKey>({
  tiles,
  values,
  columns = 4,
  className,
}: MetricGridProps<K>) {
  return (
    <div className={cn('grid gap-3', COLUMN_CLASS[columns], className)}>
      {tiles.map((spec) => (
        <MetricTile
          key={spec.key}
          definition={METRIC_DEFINITIONS[spec.key]}
          value={values[spec.key]}
          caption={spec.caption}
          href={spec.href}
          tone={spec.tone}
        />
      ))}
    </div>
  );
}
