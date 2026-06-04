// =============================================================================
// HVA-228: warning metrics + period catalogues
// =============================================================================
//
// Shared between the IssueWarningDialog (dropdown options) and the
// server action (validation + display label rendering). Keeping the
// list narrow on purpose: the warning is admin's judgment based on a
// metric, not an automated trigger — adding new metric codes is one
// edit here.
// =============================================================================

export const WARNING_METRICS = [
  { code: 'revenue', label: 'Revenue collected', unit: 'paise' as const },
  { code: 'visits', label: 'Visits completed', unit: 'count' as const },
  { code: 'orders', label: 'Orders confirmed', unit: 'count' as const },
  {
    code: 'conversion',
    label: 'Conversion rate (%)',
    unit: 'percent' as const,
  },
  {
    code: 'productive_tasks',
    label: 'Productive tasks',
    unit: 'count' as const,
  },
  { code: 'other', label: 'Other (see reason)', unit: 'count' as const },
] as const;

export type WarningMetricCode = (typeof WARNING_METRICS)[number]['code'];

export const WARNING_PERIODS = [
  { code: 'this_month', label: 'This month' },
  { code: 'last_month', label: 'Last month' },
  { code: 'this_quarter', label: 'This quarter' },
  { code: 'last_quarter', label: 'Last quarter' },
  { code: 'custom', label: 'Custom (in reason)' },
] as const;

export type WarningPeriodCode = (typeof WARNING_PERIODS)[number]['code'];

/**
 * Hard ceiling — five active hard warnings flags the exec as
 * eligible for termination. Keep this as a constant so the
 * dashboard / banner / tests all agree on the threshold.
 */
export const HARD_WARNING_FIRE_THRESHOLD = 5;

/**
 * Format a value per metric unit, suitable for inclusion in the
 * message_snapshot. Paise → ₹ comma-separated; counts → plain
 * integer; percent → "NN.N%".
 */
export function formatMetricValue(
  value: number,
  unit: 'paise' | 'count' | 'percent',
): string {
  if (unit === 'paise') {
    const rupees = value / 100;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(rupees);
  }
  if (unit === 'percent') {
    return `${(value / 10).toFixed(1)}%`;
  }
  return value.toLocaleString('en-IN');
}

export function metricByCode(code: string) {
  return WARNING_METRICS.find((m) => m.code === code);
}

export function periodByCode(code: string) {
  return WARNING_PERIODS.find((p) => p.code === code);
}
