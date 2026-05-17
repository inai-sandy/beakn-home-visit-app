// =============================================================================
// HVA-142: customer-safe cancellation reason whitelist
// =============================================================================
//
// The full set of cancellation reason codes lives in lib/rejection-reasons.ts
// (HVA-69's exec-/captain-facing taxonomy). A subset is safe to surface to
// the customer on /track/[token]; the rest carry exec-internal context
// (e.g. "Price too high", "Customer changed mind") that we'd rather not
// echo back at the customer.
//
// This file is the single source of truth for that whitelist. Hardcoded
// for now — future ticket can migrate to an `is_customer_facing` column
// on a rejection_reasons table if the list grows.
//
// Codes NOT in this whitelist fall through to a bare "Cancelled" display
// with no reason line (caller responsibility).
// =============================================================================

export const CUSTOMER_FACING_REASONS: Record<string, string> = {
  NO_LONGER_INTERESTED: 'No longer interested',
  OUT_OF_SERVICE_AREA: 'Outside our service area',
  DUPLICATE_REQUEST: 'Duplicate of another request',
};

/**
 * Returns a customer-friendly reason string if the code is in the
 * customer-facing whitelist, otherwise returns null. Null/undefined
 * input also returns null so callers can treat the result uniformly.
 */
export function getCustomerFacingReason(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return CUSTOMER_FACING_REASONS[code] ?? null;
}
