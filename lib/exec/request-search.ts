// =============================================================================
// HVA-65: pure search-matching helpers for the exec /requests filter
// =============================================================================
//
// Extracted from RequestsFilterClient.tsx so it's directly testable
// without a React render harness. Mirrors the spec text in locked
// decision #7: customer name OR phone match, case-insensitive, with
// phone matching that ignores non-digit characters on both sides so
// "9885 698 665" matches "+919885698665".
// =============================================================================

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export interface SearchableRequest {
  customerName: string;
  customerPhone: string;
}

/**
 * Returns true iff the row matches the search query. Empty/whitespace
 * query matches everything (no filter applied).
 */
export function matchesRequestSearch(row: SearchableRequest, query: string): boolean {
  const q = query.trim();
  if (q === '') return true;
  const needle = q.toLowerCase();
  if (row.customerName.toLowerCase().includes(needle)) return true;
  const needleDigits = digitsOnly(q);
  if (
    needleDigits.length > 0 &&
    digitsOnly(row.customerPhone).includes(needleDigits)
  ) {
    return true;
  }
  return false;
}
