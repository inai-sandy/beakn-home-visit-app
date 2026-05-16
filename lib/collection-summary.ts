// =============================================================================
// HVA-70 follow-up: Collection summary computation
// =============================================================================
//
// Extracted from collection-section.tsx so the math is unit-testable
// without a UI render harness, and so the route + section + tests all
// agree on the same shape.
//
// Inputs: quoted total + the raw payments rows (already filtered to a
// single visit_request). Outputs the derived ledger fields used by the
// summary block, including the new `isOverpaid` / `overpaidPaise` pair
// surfaced when the customer has paid more than the (possibly revised
// downward) quotation total.
//
// Voided rows are excluded from totals — kept in the input for caller
// transparency, dropped here.
// =============================================================================

export interface SummaryPaymentRow {
  direction: 'inbound' | 'outbound';
  amountPaise: number;
  voidedAt: Date | null;
}

export interface CollectionSummary {
  quotedPaise: number;
  inboundPaise: number;
  outboundPaise: number;
  netReceivedPaise: number;
  /**
   * Signed: positive = customer still owes; zero = fully collected;
   * negative = customer overpaid (we owe them).
   */
  balancePaise: number;
  /** Absolute overpayment amount when isOverpaid, else 0. */
  overpaidPaise: number;
  isOverpaid: boolean;
  isFullyCollected: boolean;
}

export function computeCollectionSummary(
  quotedPaise: number,
  paymentRows: ReadonlyArray<SummaryPaymentRow>,
): CollectionSummary {
  let inboundPaise = 0;
  let outboundPaise = 0;
  for (const p of paymentRows) {
    if (p.voidedAt !== null) continue;
    if (p.direction === 'inbound') inboundPaise += p.amountPaise;
    else outboundPaise += p.amountPaise;
  }
  const netReceivedPaise = inboundPaise - outboundPaise;
  const balancePaise = quotedPaise - netReceivedPaise;
  return {
    quotedPaise,
    inboundPaise,
    outboundPaise,
    netReceivedPaise,
    balancePaise,
    overpaidPaise: balancePaise < 0 ? -balancePaise : 0,
    isOverpaid: balancePaise < 0,
    isFullyCollected: balancePaise === 0,
  };
}
