// =============================================================================
// Metric SSOT — shared SQL constants
// =============================================================================
//
// Two reasons this file exists rather than inlining strings:
//   1. Typos in a status code silently return zero counts — collecting
//      the codes here makes "is this string right?" a one-place check.
//   2. The same set of constants is repeated across captain/admin/exec
//      query files today (drift-prone). All metric loaders now import
//      from here, so any future code change propagates everywhere.
// =============================================================================

/** Status stage codes referenced by metric loaders. */
export const STATUS_CODES = {
  VISIT_COMPLETED: 'VISIT_COMPLETED',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_EXECUTED_SUCCESSFULLY: 'ORDER_EXECUTED_SUCCESSFULLY',
  PENDING_CAPTAIN_APPROVAL: 'PENDING_CAPTAIN_APPROVAL',
} as const;

/** Task types that count as a "visit" for visits / conversion metrics.
 *  Mirrors the same list used by lib/captain, lib/admin, and
 *  lib/leaderboard so all four agree. */
export const VISIT_TASK_TYPES = [
  'Customer home visit',
  'Sales pitch',
  'Outlet visit',
] as const;
