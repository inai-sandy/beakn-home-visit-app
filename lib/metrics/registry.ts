import { loadCancelledRequests, loadNewRequests } from './requests';
import { loadConversionPct } from './conversion';
import { loadOrdersCount, loadOrdersValue } from './orders';
import { loadOutstanding } from './outstanding';
import { loadPendingApprovals } from './pendingApprovals';
import { loadProductiveMinutes } from './productive';
import { loadQuotationsCount, loadQuotationsValue } from './quotations';
import { loadRevenue } from './revenue';
import { loadVisits } from './visits';
import type {
  DateRange,
  MetricKey,
  MetricLoader,
  MetricScope,
} from './types';

// =============================================================================
// Metric SSOT — registry + parallel loader
// =============================================================================
//
// The registry is the single map from `MetricKey` → loader. Every
// portal (admin, captain, exec) imports `loadMetrics` and asks for the
// keys it needs in one round-trip; the helper fans them out in
// parallel and returns an object keyed by metric key. The portal never
// touches the loaders directly — that's the discipline that keeps the
// formulas locked across every surface.
//
// `definitions` carries the presentation-side metadata (label, unit,
// icon, calculation explainer) so a tile can render itself without
// the portal page passing repeated literals. The ⓘ info card surface
// (HVA-following-ticket) renders `explainer` verbatim.
//
// Loader signature: (scope, range) → number | null. `null` is only
// emitted by conversion_pct when visits = 0 in the window.
// =============================================================================

export type MetricUnit = 'paise' | 'count' | 'percent' | 'minutes';

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  shortLabel?: string;
  unit: MetricUnit;
  /** Material Symbols glyph name. */
  icon: string;
  /** Plain-English description of the formula — rendered by the ⓘ info
   *  surface so anyone hovering a tile understands what they're
   *  looking at. */
  explainer: string;
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  revenue: {
    key: 'revenue',
    label: 'Revenue collected',
    shortLabel: 'Revenue',
    unit: 'paise',
    icon: 'payments',
    explainer:
      'Sum of inbound payments (excluding voided ones) recorded against requests in the selected scope, where payment_date falls in the date range. Captains and admins recording on behalf of an exec still credit the exec.',
  },
  orders_count: {
    key: 'orders_count',
    label: 'Orders confirmed',
    shortLabel: 'Orders',
    unit: 'count',
    icon: 'check_circle',
    explainer:
      'Distinct visit requests that transitioned into ORDER_CONFIRMED at any point during the date range (rollback + reconfirm in the same window counts once). Attributed to the request’s currently assigned executive.',
  },
  orders_value: {
    key: 'orders_value',
    label: 'Order value confirmed',
    shortLabel: 'Order value',
    unit: 'paise',
    icon: 'sell',
    explainer:
      'Sum of quotation totals for distinct requests that confirmed in the date range. Each request contributes its quotation once even if it rolled back and reconfirmed.',
  },
  visits: {
    key: 'visits',
    label: 'Visits completed',
    shortLabel: 'Visits',
    unit: 'count',
    icon: 'directions_run',
    explainer:
      'Tasks of type Customer home visit / Sales pitch / Outlet visit marked completed with task_date in the date range, for executives in the selected scope.',
  },
  quotations_count: {
    key: 'quotations_count',
    label: 'Quotations submitted',
    shortLabel: 'Quotations',
    unit: 'count',
    icon: 'description',
    explainer:
      'Quotations whose submitted_at (IST) falls in the date range, on requests in the selected scope.',
  },
  quotations_value: {
    key: 'quotations_value',
    label: 'Quotation value submitted',
    shortLabel: 'Quotation value',
    unit: 'paise',
    icon: 'request_quote',
    explainer:
      'Sum of total_order_value across quotations submitted in the date range, on requests in the selected scope.',
  },
  conversion_pct: {
    key: 'conversion_pct',
    label: 'Visit → order conversion',
    shortLabel: 'Conversion',
    unit: 'percent',
    icon: 'trending_up',
    explainer:
      'Orders confirmed ÷ Visits completed × 100, both within the date range and scope. Blank when there were zero visits.',
  },
  outstanding: {
    key: 'outstanding',
    label: 'Outstanding receivable',
    shortLabel: 'Outstanding',
    unit: 'paise',
    icon: 'pending_actions',
    explainer:
      'Across all non-cancelled requests in scope: quotation total minus inbound payments, summed where positive. Includes executed-but-unpaid orders. Snapshot — ignores the date range.',
  },
  new_requests: {
    key: 'new_requests',
    label: 'New requests',
    shortLabel: 'New',
    unit: 'count',
    icon: 'inbox',
    explainer:
      'Visit requests whose created_at (IST) falls in the date range, in the selected scope. Includes requests later cancelled — intake volume, not net pipeline.',
  },
  cancelled_requests: {
    key: 'cancelled_requests',
    label: 'Cancellations',
    shortLabel: 'Cancelled',
    unit: 'count',
    icon: 'cancel',
    explainer:
      'Visit requests cancelled in the date range (by cancelled_at IST), in the selected scope.',
  },
  productive_minutes: {
    key: 'productive_minutes',
    label: 'Productive minutes',
    shortLabel: 'Productive',
    unit: 'minutes',
    icon: 'schedule',
    explainer:
      'Total minutes across tasks completed in the date range, using actual_time when provided otherwise estimated_time. 15min / 30min / 1hr / 2hr / 3hr+ buckets map to 15 / 30 / 60 / 120 / 180.',
  },
  pending_approvals: {
    key: 'pending_approvals',
    label: 'Pending approvals',
    shortLabel: 'Pending',
    unit: 'count',
    icon: 'approval',
    explainer:
      'Non-cancelled requests sitting at the PENDING_CAPTAIN_APPROVAL stage right now, in the selected scope. Snapshot — ignores the date range.',
  },
};

/** Registry of loaders keyed by metric key. Internal; external callers
 *  use `loadMetrics` so they fan out in parallel. */
const LOADERS: Record<MetricKey, MetricLoader<number | null>> = {
  revenue: loadRevenue,
  orders_count: loadOrdersCount,
  orders_value: loadOrdersValue,
  visits: loadVisits,
  quotations_count: loadQuotationsCount,
  quotations_value: loadQuotationsValue,
  conversion_pct: loadConversionPct,
  outstanding: loadOutstanding,
  new_requests: loadNewRequests,
  cancelled_requests: loadCancelledRequests,
  productive_minutes: loadProductiveMinutes,
  pending_approvals: loadPendingApprovals,
};

/** Run every requested metric in parallel under one scope/range,
 *  returning a results object keyed the same as the input keys.
 *  Duplicate keys in the input are deduped before fan-out. */
export async function loadMetrics<K extends MetricKey>(
  keys: readonly K[],
  scope: MetricScope,
  range: DateRange,
): Promise<Record<K, number | null>> {
  const uniqueKeys = Array.from(new Set(keys)) as K[];
  const results = await Promise.all(
    uniqueKeys.map((k) => LOADERS[k](scope, range)),
  );
  const out = {} as Record<K, number | null>;
  uniqueKeys.forEach((k, i) => {
    out[k] = results[i];
  });
  return out;
}

export type LoadMetricsResult<K extends MetricKey> = Record<K, number | null>;
