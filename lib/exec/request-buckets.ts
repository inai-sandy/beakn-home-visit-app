// =============================================================================
// HVA-65: bucket logic for the exec's /requests list
// =============================================================================
//
// Parallel to lib/captain/request-buckets.ts, but exec-shaped. The captain
// page buckets by ASSIGNMENT state (whose-to-pick-up), the exec page
// buckets by STAGE PROGRESSION (where-in-pipeline-my-work-is). Same
// 5-bucket UI shape, different SQL.
//
//   * Cancelled — visit_requests.cancelled_at IS NOT NULL (HVA-69 axis)
//   * Completed — status_code = 'ORDER_EXECUTED_SUCCESSFULLY'
//   * In progress — VISIT_SCHEDULED through PENDING_CAPTAIN_APPROVAL
//   * New — SUBMITTED or ASSIGNED (handed to me, not yet started)
//   * All — everything assigned to me
//
// SUBMITTED + assigned_exec_user_id IS NOT NULL is technically reachable
// (a future stage-transition path could leave assignment in place), so
// "New" includes both stages to be future-proof.
//
// Adding a new mid-pipeline stage → append to IN_PROGRESS_STATUS_CODES.
// Adding a new positive-terminal stage → append to TERMINAL_POSITIVE,
// matching the captain-side TERMINAL_POSITIVE_STATUS_CODES list.
// =============================================================================

export const EXEC_REQUEST_BUCKETS = [
  'all',
  'new',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export type ExecRequestBucket = (typeof EXEC_REQUEST_BUCKETS)[number];

export const NEW_STATUS_CODES: readonly string[] = ['SUBMITTED', 'ASSIGNED'];

export const IN_PROGRESS_STATUS_CODES: readonly string[] = [
  'VISIT_SCHEDULED',
  'VISIT_COMPLETED',
  'QUOTATION_GIVEN',
  'ORDER_CONFIRMED',
  'INSTALLATION_SCHEDULED',
  'INSTALLATION_CONFIGURATION_DONE',
  'PENDING_CAPTAIN_APPROVAL',
];

export const TERMINAL_POSITIVE_STATUS_CODES: readonly string[] = [
  'ORDER_EXECUTED_SUCCESSFULLY',
];

export interface BucketableExecRequest {
  statusCode: string;
  cancelledAt: Date | null;
}

export function categorizeExecRequest(
  row: BucketableExecRequest,
): Exclude<ExecRequestBucket, 'all'> {
  if (row.cancelledAt !== null) return 'cancelled';
  if (TERMINAL_POSITIVE_STATUS_CODES.includes(row.statusCode)) return 'completed';
  if (IN_PROGRESS_STATUS_CODES.includes(row.statusCode)) return 'in_progress';
  // Default bucket — anything else assigned to the exec is "new" work.
  // Catches SUBMITTED + ASSIGNED stages, and any future mid-pipeline
  // stage code that hasn't been added to IN_PROGRESS_STATUS_CODES yet
  // (fail safely toward "I should look at this", not "hidden away").
  return 'new';
}

export function isExecRequestBucket(value: unknown): value is ExecRequestBucket {
  return (
    typeof value === 'string' &&
    (EXEC_REQUEST_BUCKETS as readonly string[]).includes(value)
  );
}

export const EXEC_BUCKET_LABELS: Record<ExecRequestBucket, string> = {
  all: 'All',
  new: 'New',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Count rows per bucket. Always derived from the FULL row set —
 * locked decision #8 says search-filter does NOT move these counts.
 */
export function countExecRequestsByBucket(
  rows: readonly BucketableExecRequest[],
): Record<ExecRequestBucket, number> {
  const counts: Record<ExecRequestBucket, number> = {
    all: rows.length,
    new: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    counts[categorizeExecRequest(r)] += 1;
  }
  return counts;
}
