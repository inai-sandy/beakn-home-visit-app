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
