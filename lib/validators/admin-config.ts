import { z } from 'zod';

// =============================================================================
// HVA-105: validator for the customer_support_phone PATCH endpoint
// =============================================================================
//
// Required format: exactly +91 followed by 10 digits → 13 characters total,
// no spaces, no punctuation. Blank is allowed (resets to "" → /track page
// falls back to placeholder + Demo-number notice).
//
// This is stricter than the CONFIG_SCHEMA.validation.pattern (which allows
// spaces + dashes + parens), but the API is the only writer for this key
// so the stricter gate holds for everything that flows through it.
// =============================================================================

const PHONE_PATTERN = /^\+91\d{10}$/;

export const customerSupportPhoneUpdateSchema = z.object({
  value: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v !== 'string') return v;
      return v;
    },
    z
      .string()
      .refine(
        (v) => v === '' || PHONE_PATTERN.test(v),
        'Enter +91 followed by exactly 10 digits (e.g. +919876543210), or leave blank to reset.',
      ),
  ),
});

export type CustomerSupportPhoneUpdateInput = z.infer<
  typeof customerSupportPhoneUpdateSchema
>;

// =============================================================================
// HVA-90: admin_support_phone — mirrors customer_support_phone shape.
// Used by the forgot-password modal.
// =============================================================================

export const adminSupportPhoneUpdateSchema = z.object({
  value: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v !== 'string') return v;
      return v;
    },
    z
      .string()
      .refine(
        (v) => v === '' || PHONE_PATTERN.test(v),
        'Enter +91 followed by exactly 10 digits (e.g. +919876543210), or leave blank to reset.',
      ),
  ),
});

export type AdminSupportPhoneUpdateInput = z.infer<
  typeof adminSupportPhoneUpdateSchema
>;

// =============================================================================
// Monthly exec target update — input as a rupee number (the form sends
// ₹7L not 70000000), API converts to paise before persisting.
// =============================================================================

export const monthlyExecTargetUpdateSchema = z.object({
  // Rupees (the value the user types). Coerced from string in case the
  // form serialises numbers as strings. Capped at ₹1 Cr so a typo
  // (e.g. an extra zero) is caught before it propagates into every
  // exec's dashboard.
  valueRupees: z.coerce
    .number()
    .int('Enter a whole-rupee amount (no decimals).')
    .min(0, 'Target must be 0 or greater.')
    .max(10_000_000, 'Target cannot exceed ₹1 Cr.'),
});

export type MonthlyExecTargetUpdateInput = z.infer<
  typeof monthlyExecTargetUpdateSchema
>;
