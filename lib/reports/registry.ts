import {
  reportAcceptanceTrend,
  reportAovTrend,
  reportConversionTrend,
  reportCycleTime,
  reportNetCashTrend,
  reportOrdersTrend,
  reportOrderValueTrend,
  reportQuotationsTrend,
  reportRevenueTrend,
  reportVisitsTrend,
} from './sales';
import type { ReportArgs, ReportResult } from './types';

// =============================================================================
// Reports registry
// =============================================================================
//
// Sandeep 2026-06-03: 44 reports total. Each entry is a self-contained
// loader bound to a metadata record (display name, category, blurb).
// The /admin/reports/ landing page renders a card per entry; the
// /admin/reports/[key] detail page looks up the loader and runs it.
//
// Categories follow the inventory Sandeep approved:
//   sales / team / geography / operational / lifecycle / customer /
//   notifications / targets
//
// Sprint 1 (this PR) ships the Sales category. Subsequent sprints
// add the rest. The framework supports them all.
// =============================================================================

export type ReportCategory =
  | 'sales'
  | 'team'
  | 'geography'
  | 'operational'
  | 'lifecycle'
  | 'customer'
  | 'notifications'
  | 'targets';

export interface ReportDefinition {
  key: string;
  category: ReportCategory;
  title: string;
  blurb: string;
  /** Default time-series bucket for trend reports. Reports that
   *  return non-trend rows ignore this. */
  defaultBucket?: 'day' | 'week' | 'month';
  /** Loader. Same `ReportArgs` for every report. */
  load: (args: ReportArgs) => Promise<ReportResult<unknown>>;
}

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  sales: 'Sales performance',
  team: 'Team / Executive',
  geography: 'Geography',
  operational: 'Operational',
  lifecycle: 'Request lifecycle',
  customer: 'Customer / Contact',
  notifications: 'WhatsApp / Notifications',
  targets: 'Targets',
};

export function categoryLabel(c: ReportCategory): string {
  return CATEGORY_LABELS[c];
}

export const REPORTS: ReportDefinition[] = [
  // -------------------------------------------------------------------------
  // Sales (Sprint 1)
  // -------------------------------------------------------------------------
  {
    key: 'revenue-trend',
    category: 'sales',
    title: 'Revenue trend',
    blurb:
      'Net cash collected per period (inbound − outbound). Refunds reduce the row total.',
    defaultBucket: 'day',
    load: reportRevenueTrend as ReportDefinition['load'],
  },
  {
    key: 'net-cash-trend',
    category: 'sales',
    title: 'Net cash trend',
    blurb:
      'Same calc as Revenue trend, named for accounting flows. Inbound minus refunds.',
    defaultBucket: 'day',
    load: reportNetCashTrend as ReportDefinition['load'],
  },
  {
    key: 'orders-trend',
    category: 'sales',
    title: 'Orders confirmed trend',
    blurb:
      'Distinct visit_requests that transitioned into ORDER_CONFIRMED. Rollback + reconfirm in same window counts once.',
    defaultBucket: 'day',
    load: reportOrdersTrend as ReportDefinition['load'],
  },
  {
    key: 'order-value-trend',
    category: 'sales',
    title: 'Order value confirmed trend',
    blurb:
      'Sum of quotation totals for confirmed orders, per period. Quotations are 1:1 with requests so no double-count.',
    defaultBucket: 'day',
    load: reportOrderValueTrend as ReportDefinition['load'],
  },
  {
    key: 'visits-trend',
    category: 'sales',
    title: 'Visits completed trend',
    blurb:
      'Completed visit-type tasks (Customer home visit / Sales pitch / Outlet visit) per period.',
    defaultBucket: 'day',
    load: reportVisitsTrend as ReportDefinition['load'],
  },
  {
    key: 'conversion-trend',
    category: 'sales',
    title: 'Conversion % trend',
    blurb:
      'Orders ÷ visits per period. Blank when there are zero visits.',
    defaultBucket: 'week',
    load: reportConversionTrend as ReportDefinition['load'],
  },
  {
    key: 'quotations-trend',
    category: 'sales',
    title: 'Quotations submitted trend',
    blurb:
      'Quotations submitted per period, with total value submitted.',
    defaultBucket: 'day',
    load: reportQuotationsTrend as ReportDefinition['load'],
  },
  {
    key: 'acceptance-trend',
    category: 'sales',
    title: 'Quotation → Order acceptance',
    blurb:
      'For each period, share of submitted quotations whose request later reached ORDER_CONFIRMED (cumulative — quotations submitted long ago still count if the order is in soon enough).',
    defaultBucket: 'week',
    load: reportAcceptanceTrend as ReportDefinition['load'],
  },
  {
    key: 'aov-trend',
    category: 'sales',
    title: 'Average order value trend',
    blurb:
      'Order value ÷ orders confirmed, per period. Useful to spot premium-mix shifts over time.',
    defaultBucket: 'week',
    load: reportAovTrend as ReportDefinition['load'],
  },
  {
    key: 'cycle-time',
    category: 'sales',
    title: 'Cycle time (visit → order)',
    blurb:
      'Days between the first completed visit task and the ORDER_CONFIRMED transition, per confirmed order in the window.',
    load: reportCycleTime as ReportDefinition['load'],
  },
];

export function findReport(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}

export function groupReportsByCategory(): Array<{
  category: ReportCategory;
  label: string;
  reports: ReportDefinition[];
}> {
  const map = new Map<ReportCategory, ReportDefinition[]>();
  for (const r of REPORTS) {
    if (!map.has(r.category)) map.set(r.category, []);
    map.get(r.category)!.push(r);
  }
  return Array.from(map.entries()).map(([category, reports]) => ({
    category,
    label: CATEGORY_LABELS[category],
    reports,
  }));
}
