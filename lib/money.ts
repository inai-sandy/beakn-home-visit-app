// =============================================================================
// HVA-70: paise <-> INR helpers
// =============================================================================
//
// INR is the only currency in HVA Phase 1. Storage unit is paise (bigint).
// Display unit is rupees (string with ₹ + Indian digit grouping).
//
// rupeesToPaise: parses user input like "1,23,456.78", "1.5 lakh" (NOT
// supported — just rupees), trims whitespace; rejects non-numeric. NaN
// callers get null back so the validator can produce a tidy field error.
// =============================================================================

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatInrFromPaise(paise: number | bigint | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const n = typeof paise === 'bigint' ? Number(paise) : paise;
  if (!Number.isFinite(n)) return '—';
  return inrFormatter.format(n / 100);
}

/**
 * Parse a free-text rupee input (e.g. "1,23,456.78", "5000", "5000.5")
 * into paise as a positive integer. Returns null when the input does not
 * resolve to a positive number with at most 2 decimal places.
 */
export function rupeesStringToPaise(input: string): number | null {
  const cleaned = input.replace(/[,\s₹]/gu, '');
  if (cleaned === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/u.test(cleaned)) return null;
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}
