// =============================================================================
// HVA-127: phone-number display masking for captain-facing surfaces
// =============================================================================
//
// The stored form is '+91' + 10 digits (no separators). For captain/exec
// surfaces we display a partially-masked variant: country code + first 3
// digits + middle 3 masked + last 4 digits. The captain doesn't need the
// full number to recognise the customer; the call-to-customer affordance
// elsewhere uses the raw number through a tel: link, which keeps the
// dialed value correct while the on-screen value stays masked.
//
//   '+919949999599' → '+91 994-XXX-9599'
//
// The HVA-127 brief's example showed '+91 994-XXXX-9599' (XXXX = 4
// chars) which would imply 11 digits after +91; Indian mobile is 10
// digits. Adopted "3 + 3-masked + 4" so the math works cleanly.
//
// Returns the raw input on any malformed value — never throws.
// =============================================================================

const STORED_PREFIX = '+91';
const MASK_CHARS = 'XXX';

export function maskCustomerPhone(stored: string): string {
  if (typeof stored !== 'string') return String(stored ?? '');
  if (!stored.startsWith(STORED_PREFIX)) return stored;
  const digits = stored.slice(STORED_PREFIX.length);
  if (digits.length !== 10 || !/^\d{10}$/u.test(digits)) return stored;
  return `${STORED_PREFIX} ${digits.slice(0, 3)}-${MASK_CHARS}-${digits.slice(6, 10)}`;
}
