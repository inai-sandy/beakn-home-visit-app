import { CityShareChart } from './CityShareChart';
import { ConversionTrendChart } from './ConversionTrendChart';
import { RevenueTrendChart } from './RevenueTrendChart';
import { StatusFunnelChart } from './StatusFunnelChart';
import { TopExecsChart } from './TopExecsChart';
import { VisitsOrdersChart } from './VisitsOrdersChart';

import type { GraphsBundle } from '@/lib/reports/graphs';
import type { ReportScope } from '@/lib/reports/types';

interface Props {
  bundle: GraphsBundle;
  scope: ReportScope;
  windowLabel: string;
}

// =============================================================================
// GraphsView — the responsive grid of 6 chart cards
// =============================================================================
//
// Server component. Receives a fully-loaded bundle + scope + label, and
// renders the cards. Each card is a client component so charts hydrate
// after first paint. Layout adapts:
//   - mobile: 1 col
//   - md:     1 col (gives charts room)
//   - lg+:    2 cols (revenue + conversion side-by-side, etc.)
//
// Funnel takes full width below the 2-col rows because it benefits
// from the long horizontal extent.
// =============================================================================

export function GraphsView({ bundle, scope, windowLabel }: Props) {
  const isExecScope = scope.kind === 'exec';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueTrendChart data={bundle.revenue} windowLabel={windowLabel} />
        <VisitsOrdersChart
          data={bundle.visitsOrders}
          windowLabel={windowLabel}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConversionTrendChart
          data={bundle.conversion}
          windowLabel={windowLabel}
        />
        <TopExecsChart
          data={bundle.topExecs}
          windowLabel={windowLabel}
          isExecScope={isExecScope}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatusFunnelChart data={bundle.funnel} windowLabel={windowLabel} />
        <CityShareChart data={bundle.cityShare} windowLabel={windowLabel} />
      </div>
    </div>
  );
}
