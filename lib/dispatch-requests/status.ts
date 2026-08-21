// =============================================================================
// HVA-342: rolling per-order decisions up to one request status
// =============================================================================
//
// A request is a set of order groups, each decided on its own. The header
// status is therefore derived, never asserted — the old Assist bug was a
// status somebody set by hand that nothing else agreed with.
//
// Pure functions, no DB, so the rule is cheap to test and impossible to hold
// differently in two places.
// =============================================================================

export type DispatchRequestOrderStatus =
  | 'pending'
  | 'approved'
  | 'held'
  | 'rejected';

export type DispatchRequestStatus = 'open' | 'closed' | 'cancelled';

export const ORDER_STATUS_LABEL: Record<DispatchRequestOrderStatus, string> = {
  pending: 'Waiting on support',
  approved: 'Dispatched',
  // Deliberately not "Pending": an exec has to be able to tell "nobody has
  // looked at this" from "support looked and cannot ship it yet".
  held: 'On hold',
  rejected: 'Declined',
};

export const REQUEST_STATUS_LABEL: Record<DispatchRequestStatus, string> = {
  open: 'Open',
  closed: 'Completed',
  cancelled: 'Withdrawn',
};

/**
 * A group is settled when it will not change again without somebody acting.
 *
 * `held` is NOT settled — it is support saying "not yet", so the request
 * stays open and keeps showing up as outstanding work. Treating a hold as
 * finished would let a request the exec is still waiting on disappear from
 * the queue, which is exactly how a customer ends up un-chased.
 */
export function isSettled(status: DispatchRequestOrderStatus): boolean {
  return status === 'approved' || status === 'rejected';
}

/**
 * Derive the header status from the group statuses.
 *
 * An empty group list reads 'open' rather than 'closed': a request with
 * nothing in it is a data problem, and closing it would hide it.
 */
export function deriveRequestStatus(
  groupStatuses: readonly DispatchRequestOrderStatus[],
): Extract<DispatchRequestStatus, 'open' | 'closed'> {
  if (groupStatuses.length === 0) return 'open';
  return groupStatuses.every(isSettled) ? 'closed' : 'open';
}

/**
 * One-line summary for the exec's list, e.g. "2 dispatched · 1 on hold".
 *
 * Ordered by what the exec most needs to see first: what is still waiting on
 * somebody, then what is done.
 */
export function summariseGroups(
  groupStatuses: readonly DispatchRequestOrderStatus[],
): string {
  const count = (s: DispatchRequestOrderStatus): number =>
    groupStatuses.filter((g) => g === s).length;

  const parts: string[] = [];
  const pending = count('pending');
  const held = count('held');
  const approved = count('approved');
  const rejected = count('rejected');

  if (pending > 0) parts.push(`${pending} waiting`);
  if (held > 0) parts.push(`${held} on hold`);
  if (approved > 0) parts.push(`${approved} dispatched`);
  if (rejected > 0) parts.push(`${rejected} declined`);

  return parts.length > 0 ? parts.join(' · ') : 'Nothing requested';
}
