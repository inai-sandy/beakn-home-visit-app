import { describe, expect, it } from 'vitest';

import { normalizeIndianPhone, toStorageFormat } from '@/lib/phone';

// =============================================================================
// HVA-73 PR 2: normalizeIndianPhone
// =============================================================================

describe('normalizeIndianPhone', () => {
  it('accepts a bare 10-digit input', () => {
    expect(normalizeIndianPhone('9876543210')).toBe('9876543210');
  });

  it('strips +91 prefix', () => {
    expect(normalizeIndianPhone('+919876543210')).toBe('9876543210');
  });

  it('strips a leading 91 without +', () => {
    expect(normalizeIndianPhone('919876543210')).toBe('9876543210');
  });

  it('strips a leading 0 (national-format prefix)', () => {
    expect(normalizeIndianPhone('09876543210')).toBe('9876543210');
  });

  it('strips spaces, hyphens, and parentheses', () => {
    expect(normalizeIndianPhone('98765 43210')).toBe('9876543210');
    expect(normalizeIndianPhone('+91 9876-543210')).toBe('9876543210');
    expect(normalizeIndianPhone('(987) 654-3210')).toBe('9876543210');
  });

  it('rejects a too-short input', () => {
    expect(normalizeIndianPhone('98765')).toBeNull();
  });

  it('rejects a too-long input that does not match the trim cases', () => {
    expect(normalizeIndianPhone('988765432109')).toBeNull();
  });

  it('rejects a mobile number whose first digit is < 6', () => {
    expect(normalizeIndianPhone('1234567890')).toBeNull();
    expect(normalizeIndianPhone('5234567890')).toBeNull();
  });

  it('rejects empty / null / undefined', () => {
    expect(normalizeIndianPhone('')).toBeNull();
    expect(normalizeIndianPhone(null)).toBeNull();
    expect(normalizeIndianPhone(undefined)).toBeNull();
  });
});

describe('toStorageFormat', () => {
  it('prepends +91 to a normalisable input', () => {
    expect(toStorageFormat('9876543210')).toBe('+919876543210');
    expect(toStorageFormat('+91 98765 43210')).toBe('+919876543210');
  });

  it('returns null when normalisation fails', () => {
    expect(toStorageFormat('not a phone')).toBeNull();
  });
});
