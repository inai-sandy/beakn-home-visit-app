// =============================================================================
// HVA-127: bucket logic for the captain's /captain/requests list
// =============================================================================
//
// `status_stages` doesn't carry an `is_terminal` or `category` column, so
// bucketing is code-driven. Authority:
//   * Cancelled — visit_requests.cancelled_at IS NOT NULL (HVA-69 cancellation axis)
//   * Completed — status_stages.code = 'ORDER_EXECUTED_SUCCESSFULLY' (the
//                 only positive-terminal stage in the seeded pipeline)
//   * Assigned  — assigned_exec_user_id IS NOT NULL, not terminal
//   * Open      — assigned_exec_user_id IS NULL, not terminal
//
// Adding a new positive-terminal stage in the future = update
// TERMINAL_POSITIVE_STATUS_CODES below + the test that asserts the
// bucket distribution.
// =============================================================================

export const CAPTAIN_REQUEST_BUCKETS = [
  'all',
  'open',
  'assigned',
  'completed',
  'cancelled',
] as const;

export type CaptainRequestBucket = (typeof CAPTAIN_REQUEST_BUCKETS)[number];

export const TERMINAL_POSITIVE_STATUS_CODES: readonly string[] = [
  'ORDER_EXECUTED_SUCCESSFULLY',
];

export interface BucketableRequest {
  statusCode: string;
  assignedExecUserId: string | null;
  cancelledAt: Date | null;
}

export function categorizeRequest(row: BucketableRequest): CaptainRequestBucket {
  if (row.cancelledAt !== null) return 'cancelled';
  if (TERMINAL_POSITIVE_STATUS_CODES.includes(row.statusCode)) return 'completed';
  if (row.assignedExecUserId !== null) return 'assigned';
  return 'open';
}

export function isCaptainRequestBucket(
  value: unknown,
): value is CaptainRequestBucket {
  return (
    typeof value === 'string' &&
    (CAPTAIN_REQUEST_BUCKETS as readonly string[]).includes(value)
  );
}

export const BUCKET_LABELS: Record<CaptainRequestBucket, string> = {
  all: 'All',
  open: 'Open',
  assigned: 'Assigned',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
