// =============================================================================
// HVA-127 / HVA-153: bucket logic for the captain's /captain/requests list
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
// HVA-153 lift: the same code-driven rules are now also expressed as
// Drizzle SQL builders so the captain page can filter + count at the
// server. `categorizeRequest` stays for in-memory call sites (existing
// tests).
//
// Adding a new positive-terminal stage in the future = update
// TERMINAL_POSITIVE_STATUS_CODES below + bucketWhereClause() + the test
// that asserts the bucket distribution.
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

// HVA-129: 'open' bucket key kept for URL stability (?bucket=open still works)
// but the user-facing label is "New" — matches Sandeep's original Q1 spec
// during the flow audit. Submitted + unassigned = the captain's action queue.
export const BUCKET_LABELS: Record<CaptainRequestBucket, string> = {
  all: 'All',
  open: 'New',
  assigned: 'Assigned',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// =============================================================================
// HVA-153: SQL builders for server-side bucket filtering + count rollup
// =============================================================================

import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import { statusStages, visitRequests } from '@/db/schema';

/**
 * Returns the SQL predicate matching a single bucket. `all` returns
 * undefined so the caller composes only the scope filter.
 */
export function bucketWhereClause(bucket: CaptainRequestBucket) {
  switch (bucket) {
    case 'all':
      return undefined;
    case 'cancelled':
      return isNotNull(visitRequests.cancelledAt);
    case 'completed':
      return and(
        isNull(visitRequests.cancelledAt),
        eq(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'),
      );
    case 'assigned':
      return and(
        isNull(visitRequests.cancelledAt),
        ne(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'),
        isNotNull(visitRequests.assignedExecUserId),
      );
    case 'open':
      return and(
        isNull(visitRequests.cancelledAt),
        ne(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'),
        isNull(visitRequests.assignedExecUserId),
      );
  }
}

/**
 * GROUP BY a CASE expression rolling each row up into its bucket name.
 * The caller composes the scope predicate (city, exec, search) and
 * passes it as `scopeWhere`; bucket filtering is intentionally omitted
 * so the chip counts stay independent of the active bucket (D6).
 *
 * Returns counts for every bucket key — missing keys default to 0 so
 * the caller doesn't have to.
 */
export const BUCKET_CASE_SQL = sql<string>`
  CASE
    WHEN ${visitRequests.cancelledAt} IS NOT NULL THEN 'cancelled'
    WHEN ${statusStages.code} = 'ORDER_EXECUTED_SUCCESSFULLY' THEN 'completed'
    WHEN ${visitRequests.assignedExecUserId} IS NOT NULL THEN 'assigned'
    ELSE 'open'
  END
`;

export function emptyBucketCounts(): Record<CaptainRequestBucket, number> {
  return { all: 0, open: 0, assigned: 0, completed: 0, cancelled: 0 };
}
