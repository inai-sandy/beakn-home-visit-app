import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_FACING_REASONS,
  getCustomerFacingReason,
} from '@/lib/cancellation-reasons';

// =============================================================================
// HVA-142: customer-safe cancellation reason whitelist
// =============================================================================
//
// Pins the whitelist contract for the /track customer page:
//   - the three approved codes resolve to the friendly strings,
//   - exec-only codes and unknown codes return null so the caller hides
//     the reason line entirely.
// =============================================================================

describe('getCustomerFacingReason', () => {
  it("returns 'No longer interested' for NO_LONGER_INTERESTED", () => {
    expect(getCustomerFacingReason('NO_LONGER_INTERESTED')).toBe(
      'No longer interested',
    );
  });

  it("returns 'Outside our service area' for OUT_OF_SERVICE_AREA", () => {
    expect(getCustomerFacingReason('OUT_OF_SERVICE_AREA')).toBe(
      'Outside our service area',
    );
  });

  it("returns 'Duplicate of another request' for DUPLICATE_REQUEST", () => {
    expect(getCustomerFacingReason('DUPLICATE_REQUEST')).toBe(
      'Duplicate of another request',
    );
  });

  it('returns null for PRICE_TOO_HIGH (in enum but not customer-safe)', () => {
    expect(getCustomerFacingReason('PRICE_TOO_HIGH')).toBeNull();
  });

  it('returns null for OTHER (free-text, never customer-safe)', () => {
    expect(getCustomerFacingReason('OTHER')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getCustomerFacingReason(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getCustomerFacingReason(undefined)).toBeNull();
  });

  it('returns null for unrecognised codes', () => {
    expect(getCustomerFacingReason('NONEXISTENT_CODE')).toBeNull();
  });

  it('whitelist has exactly 3 entries; adding more requires updating this test', () => {
    expect(Object.keys(CUSTOMER_FACING_REASONS).sort()).toEqual([
      'DUPLICATE_REQUEST',
      'NO_LONGER_INTERESTED',
      'OUT_OF_SERVICE_AREA',
    ]);
  });
});
