// =============================================================================
// HVA-326: the CartPlus cancellation reason, in one place
// =============================================================================
//
// These constants used to live in handler-order-cancelled.ts, with
// apply-status.ts importing them from there. Making the handler delegate its
// cancel to apply-status (so the two cancel routes cannot drift) would have
// closed that import into a cycle, so the shared values move here — which is
// where they belonged anyway, being shared by definition.
// =============================================================================

export const PORTAL_CANCEL_REASON_CODE = 'portal_cancelled';
export const PORTAL_CANCEL_REASON = 'Cancelled in CartPlus portal';
