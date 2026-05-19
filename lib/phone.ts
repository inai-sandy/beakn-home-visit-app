// =============================================================================
// HVA-73 PR 2: phone normalisation for find-or-create-contact lookups
// =============================================================================
//
// Storage convention across visit_requests.customer_phone and leads.phone is
// '+91' + 10 digits. Customer-facing input arrives in many shapes:
//
//   '+919876543210'   → 9876543210
//   '919876543210'    → 9876543210
//   '09876543210'     → 9876543210
//   '9876543210'      → 9876543210
//   '98765 43210'     → 9876543210
//   '+91 9876-543210' → 9876543210
//
// Indian mobile is 10 digits, first digit 6-9.
//
// Returns the 10-digit normalised form, or null when the input can't be
// reduced to a valid Indian mobile (caller decides whether to fail closed
// or skip).
// =============================================================================

export function normalizeIndianPhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const digits = String(input).replace(/\D/gu, '');
  if (digits.length === 0) return null;

  // 12-digit "919876543210" or "0919876543210" patterns → trim the 91/091.
  let normalised = digits;
  if (normalised.length === 12 && normalised.startsWith('91')) {
    normalised = normalised.slice(2);
  } else if (normalised.length === 13 && normalised.startsWith('091')) {
    normalised = normalised.slice(3);
  } else if (normalised.length === 11 && normalised.startsWith('0')) {
    normalised = normalised.slice(1);
  }

  if (normalised.length !== 10) return null;
  if (!/^[6-9]\d{9}$/u.test(normalised)) return null;
  return normalised;
}

/** Convenience: '+91' + normalised digits, or null. */
export function toStorageFormat(input: string | null | undefined): string | null {
  const normalised = normalizeIndianPhone(input);
  return normalised ? `+91${normalised}` : null;
}
