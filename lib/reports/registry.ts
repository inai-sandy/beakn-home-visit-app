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
import {
  reportCaptainRollup,
  reportExecContacts,
  reportExecConversion,
  reportExecOrders,
  reportExecProductive,
  reportExecRevenue,
  reportExecTaskCompletion,
  reportExecVisits,
} from './team';
import {
  reportApprovalSla,
  reportApprovalsQueueDepth,
  reportCancellationTrend,
  reportCityConversion,
  reportCityHeatmap,
  reportCityOrders,
  reportCityRevenue,
  reportDayPlanClose,
  reportOutstandingAging,
  reportRefundTrend,
  reportTaskRollover,
} from './geography';
import {
  reportAverageStageTime,
  reportRequestIntake,
  reportStatusFunnel,
  reportStuckRequests,
} from './lifecycle';
import {
  reportLeadConversion,
  reportNewLeads,
  reportRepeatCustomers,
  reportRequestDistribution,
} from './customer';
import {
  reportCityTargetRollup,
  reportExecTargetAchievement,
  reportTargetPacing,
  reportWaDeliveryRates,
  reportWaFailures,
  reportWaMessagesPerTemplate,
} from './notifications-targets';
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
  // -------------------------------------------------------------------------
  // Team / Exec (Sprint 2)
  // -------------------------------------------------------------------------
  {
    key: 'exec-revenue',
    category: 'team',
    title: 'Per-exec revenue',
    blurb:
      'Net cash collected per executive in the window (inbound − outbound refunds). Sorted by revenue desc.',
    load: reportExecRevenue as ReportDefinition['load'],
  },
  {
    key: 'exec-orders',
    category: 'team',
    title: 'Per-exec orders confirmed',
    blurb:
      'Distinct orders confirmed (count + total quotation value) per executive in the window.',
    load: reportExecOrders as ReportDefinition['load'],
  },
  {
    key: 'exec-visits',
    category: 'team',
    title: 'Per-exec visits completed',
    blurb:
      'Completed visit-type tasks per executive (Customer home visit / Sales pitch / Outlet visit) in the window.',
    load: reportExecVisits as ReportDefinition['load'],
  },
  {
    key: 'exec-conversion',
    category: 'team',
    title: 'Per-exec conversion %',
    blurb:
      'Orders ÷ visits per executive. Blank when an exec had zero visits in the window.',
    load: reportExecConversion as ReportDefinition['load'],
  },
  {
    key: 'exec-task-completion',
    category: 'team',
    title: 'Per-exec task completion %',
    blurb:
      'Completed tasks ÷ all tasks (completed + pending + postponed) per executive.',
    load: reportExecTaskCompletion as ReportDefinition['load'],
  },
  {
    key: 'exec-productive',
    category: 'team',
    title: 'Per-exec productive minutes',
    blurb:
      'Sum of actual/estimated minutes on completed tasks per executive (15min / 30min / 1hr / 2hr / 3hr+ buckets map to 15 / 30 / 60 / 120 / 180).',
    load: reportExecProductive as ReportDefinition['load'],
  },
  {
    key: 'exec-contacts',
    category: 'team',
    title: 'Per-exec new contacts captured',
    blurb:
      'Leads created by each executive in the window. Useful to spot pipeline-building activity vs deal-closing.',
    load: reportExecContacts as ReportDefinition['load'],
  },
  {
    key: 'captain-rollup',
    category: 'team',
    title: 'Per-captain team rollup',
    blurb:
      'Captains ranked by their team total revenue / orders / visits / contacts in the window.',
    load: reportCaptainRollup as ReportDefinition['load'],
  },
  // -------------------------------------------------------------------------
  // Geography (Sprint 3)
  // -------------------------------------------------------------------------
  {
    key: 'city-revenue',
    category: 'geography',
    title: 'Per-city revenue',
    blurb:
      'Net cash collected per city in the window. Sorted by revenue desc.',
    load: reportCityRevenue as ReportDefinition['load'],
  },
  {
    key: 'city-orders',
    category: 'geography',
    title: 'Per-city orders',
    blurb:
      'Confirmed orders + total order value per city.',
    load: reportCityOrders as ReportDefinition['load'],
  },
  {
    key: 'city-conversion',
    category: 'geography',
    title: 'Per-city conversion %',
    blurb:
      'Orders ÷ visits per city. Highlights which cities convert visits into orders most efficiently.',
    load: reportCityConversion as ReportDefinition['load'],
  },
  {
    key: 'city-heatmap',
    category: 'geography',
    title: 'City revenue per active exec',
    blurb:
      'Revenue ÷ active execs per city. Surfaces high-efficiency cities (great cash per head) and undersupplied ones.',
    load: reportCityHeatmap as ReportDefinition['load'],
  },
  // -------------------------------------------------------------------------
  // Operational (Sprint 3)
  // -------------------------------------------------------------------------
  {
    key: 'day-plan-close',
    category: 'operational',
    title: 'Day-plan close rate',
    blurb:
      'Per-day count of plans submitted vs plans closed before the deadline. Surfaces execs leaving plans unclosed at the end of the day.',
    load: reportDayPlanClose as ReportDefinition['load'],
  },
  {
    key: 'task-rollover',
    category: 'operational',
    title: 'Rolled-over task rate',
    blurb:
      'Tasks per day that the 21:31 IST cron rolled over because they were left pending. High rates → planning gap.',
    load: reportTaskRollover as ReportDefinition['load'],
  },
  {
    key: 'approvals-depth',
    category: 'operational',
    title: 'Pending approvals queue depth',
    blurb:
      'Current snapshot of the captain-approval queue. Historical depth requires status-history reconstruction — coming as a follow-up.',
    load: reportApprovalsQueueDepth as ReportDefinition['load'],
  },
  {
    key: 'approval-sla',
    category: 'operational',
    title: 'Captain approval SLA',
    blurb:
      'For each order executed in the window, the hours it spent in PENDING_CAPTAIN_APPROVAL before the captain marked it done.',
    load: reportApprovalSla as ReportDefinition['load'],
  },
  {
    key: 'cancellation-trend',
    category: 'operational',
    title: 'Cancellation rate trend',
    blurb:
      'Per day: requests created vs cancelled (cancellation_at IST) with the % rate.',
    load: reportCancellationTrend as ReportDefinition['load'],
  },
  {
    key: 'refund-trend',
    category: 'operational',
    title: 'Refund frequency + value',
    blurb:
      'Outbound payments per day with count + total refunded amount. Refund volume is a quality signal worth watching.',
    load: reportRefundTrend as ReportDefinition['load'],
  },
  {
    key: 'outstanding-aging',
    category: 'operational',
    title: 'Outstanding aging snapshot',
    blurb:
      'Current outstanding receivables bucketed by days since quotation submitted: 0-7 / 8-30 / 30+. Net of refunds.',
    load: reportOutstandingAging as ReportDefinition['load'],
  },
  // -------------------------------------------------------------------------
  // Lifecycle (Sprint 4 — reports 31-34)
  // -------------------------------------------------------------------------
  {
    key: 'status-funnel',
    category: 'lifecycle',
    title: 'Status-stage funnel',
    blurb:
      'For each status stage, distinct requests that EVER reached it during the window. Use sequence order to spot drop-offs.',
    load: reportStatusFunnel as ReportDefinition['load'],
  },
  {
    key: 'stuck-requests',
    category: 'lifecycle',
    title: 'Stuck requests',
    blurb:
      'Non-cancelled, non-executed requests whose current status hasn\'t changed for more than 7 days. Sorted by oldest first.',
    load: reportStuckRequests as ReportDefinition['load'],
  },
  {
    key: 'avg-stage-time',
    category: 'lifecycle',
    title: 'Average days at each stage',
    blurb:
      'For every stage transition that has a "next" transition, the average days between them. Reveals which stages slow the funnel.',
    load: reportAverageStageTime as ReportDefinition['load'],
  },
  {
    key: 'request-intake',
    category: 'lifecycle',
    title: 'New request intake trend',
    blurb:
      'Customer-submitted visit requests per day (created_at IST). Includes ones that were later cancelled — intake volume, not net pipeline.',
    load: reportRequestIntake as ReportDefinition['load'],
  },
  // -------------------------------------------------------------------------
  // Customer (Sprint 4 — reports 35-38)
  // -------------------------------------------------------------------------
  {
    key: 'new-leads',
    category: 'customer',
    title: 'New leads per day',
    blurb:
      'Lead/contact rows created in the window. Pipeline-building activity.',
    load: reportNewLeads as ReportDefinition['load'],
  },
  {
    key: 'lead-conversion',
    category: 'customer',
    title: 'Lead → request conversion %',
    blurb:
      'Per day: leads created vs leads that became a visit_request (converted_to_request_id IS NOT NULL).',
    load: reportLeadConversion as ReportDefinition['load'],
  },
  {
    key: 'repeat-customers',
    category: 'customer',
    title: 'Repeat customers',
    blurb:
      'Customers (by phone) with more than one non-cancelled visit_request. Sorted by request count desc.',
    load: reportRepeatCustomers as ReportDefinition['load'],
  },
  {
    key: 'request-distribution',
    category: 'customer',
    title: 'Request distribution (BHK)',
    blurb:
      'BHK breakdown of non-cancelled visit_requests created in the window. Useful for product-mix planning.',
    load: reportRequestDistribution as ReportDefinition['load'],
  },
  // -------------------------------------------------------------------------
  // Notifications (Sprint 4 — reports 39-41)
  // -------------------------------------------------------------------------
  {
    key: 'wa-messages',
    category: 'notifications',
    title: 'WhatsApp messages per template',
    blurb:
      'Lifetime count of dispatches per template (sent / delivered / read / failed). From whatsapp_dispatches telemetry.',
    load: reportWaMessagesPerTemplate as ReportDefinition['load'],
  },
  {
    key: 'wa-delivery-rates',
    category: 'notifications',
    title: 'WhatsApp delivery + read rates',
    blurb:
      'Per template: delivery % and read % (both relative to sent). Useful to spot templates that Meta rate-limits or customers ignore.',
    load: reportWaDeliveryRates as ReportDefinition['load'],
  },
  {
    key: 'wa-failures',
    category: 'notifications',
    title: 'WhatsApp failure reasons',
    blurb:
      'Failed dispatches grouped by Meta error code + reason. Drives template/template-data corrections.',
    load: reportWaFailures as ReportDefinition['load'],
  },
  // -------------------------------------------------------------------------
  // Targets (Sprint 4 — reports 42-44)
  // -------------------------------------------------------------------------
  {
    key: 'exec-target-achievement',
    category: 'targets',
    title: 'Per-exec target achievement',
    blurb:
      'Each active exec\'s month-to-date orders + revenue vs the configured monthly target. Sorted by combined % desc.',
    load: reportExecTargetAchievement as ReportDefinition['load'],
  },
  {
    key: 'city-target-rollup',
    category: 'targets',
    title: 'Per-city target rollup',
    blurb:
      'Aggregates exec targets up to the city. Splits multi-city execs proportionally so the sum reconciles to total exec output.',
    load: reportCityTargetRollup as ReportDefinition['load'],
  },
  {
    key: 'target-pacing',
    category: 'targets',
    title: 'Target pacing',
    blurb:
      'Days elapsed vs expected % (linear pace) vs achieved %. Gap shows whether the team is ahead or behind schedule.',
    load: reportTargetPacing as ReportDefinition['load'],
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
