// =============================================================================
// HVA-329: the phrasing a cancellation needs, written once
// =============================================================================
//
// A cancellation means the same two things to support whichever door it came
// through — the stage it died at, and whether stock is already out. HVA-326
// wrote both phrases for the CartPlus path only, so when the customer-cancel
// path finally reached support (this ticket) the choice was to copy them or
// to share them. Copied phrasing drifts: the day someone softens the recovery
// warning, only one of the two cancellation paths would get the new wording.
// =============================================================================

/** " while at Installation Scheduled" — cancelled at Quotation Given is a very
 *  different problem from cancelled at Installation Scheduled. */
export function stagePhrase(stageName: string | null | undefined): string {
  return stageName && stageName.trim().length > 0
    ? ` while at ${stageName.trim()}`
    : '';
}

/**
 * The part that decides whether someone has to physically chase something.
 * Deliberately blunt — a soft phrasing here costs real money.
 */
export function dispatchWarning(count: number | null | undefined): string {
  if (typeof count !== 'number' || count <= 0) return '';
  const unit = count === 1 ? 'item has' : 'items have';
  return ` ${count} ${unit} already been dispatched and will need to be recovered manually.`;
}
