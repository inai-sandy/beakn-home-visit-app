// =============================================================================
// HVA-69: customer rejection reason taxonomy
// =============================================================================
//
// Single source of truth for the closed set of rejection codes that
// exec / captain / super_admin can record when marking a request
// rejected on the customer's behalf. The codes are stored verbatim in
// visit_requests.cancellation_reason_code (varchar 64).
//
// Pattern matches HVA-107's USER_ROLES / Role / isRole shape: typed
// union derived from the const map, named display labels, type guard
// for HTTP boundary narrowing.
//
// Adding a code:
//   1. Append a key+label here.
//   2. Tests pick it up automatically via REJECTION_REASON_CODES.
//   3. No migration needed — the column is varchar, not pgEnum.
// =============================================================================

export const REJECTION_REASONS = {
  PRICE_TOO_HIGH: 'Price too high',
  PRODUCT_NOT_SUITABLE: "Product didn't suit requirements",
  CHANGED_MIND: 'Customer changed mind',
  FOUND_ALTERNATIVE: 'Found alternative solution',
  NO_LONGER_INTERESTED: 'No longer interested',
  // HVA-142: customer-safe codes added so the tracking page (and any
  // future customer-visible surface) can show a friendly reason via
  // `lib/cancellation-reasons.getCustomerFacingReason`.
  OUT_OF_SERVICE_AREA: 'Outside our service area',
  DUPLICATE_REQUEST: 'Duplicate of another request',
  OTHER: 'Other (specify in note)',
} as const satisfies Record<string, string>;

/** Union type of the six valid reason codes. */
export type RejectionReason = keyof typeof REJECTION_REASONS;

/** Array of codes for client iteration (dropdown rendering). */
export const REJECTION_REASON_CODES = Object.keys(REJECTION_REASONS) as RejectionReason[];

/** Narrow an unknown value to RejectionReason. Server-side input gate. */
export function isRejectionReason(value: unknown): value is RejectionReason {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(REJECTION_REASONS, value)
  );
}

/**
 * `OTHER` requires a free-text note (the dropdown alone wouldn't be
 * specific enough). All other codes treat the note as optional.
 */
export const REASON_REQUIRES_NOTE: ReadonlySet<RejectionReason> = new Set([
  'OTHER',
]);

/** Display label lookup — for UI rendering or audit pretty-print. */
export function rejectionLabel(code: RejectionReason): string {
  return REJECTION_REASONS[code];
}
