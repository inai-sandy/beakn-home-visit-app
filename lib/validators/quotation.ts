import { z } from 'zod';

// =============================================================================
// HVA-70: quotation validators
// =============================================================================
//
// Spec deviations (vs original Linear body) baked in:
//   * No quotation builder / GST / PDF — only headline total + optional
//     quotation_number + optional notes.
//   * Quotation is MUTABLE — every revision is audited via the
//     quotation_updated event_type.
// =============================================================================

// Bigint paise — full INR rupee range (~92 quadrillion paise). We cap
// well below that to catch obvious typos: 1 lakh crore paise =
// 10^14 = 1,000 crore INR. No real order is that big.
const MAX_PAISE = 100_000_000_000_000; // 1 lakh crore paise

// Normalise blanks ('', '   ', undefined) to undefined so the route writes
// NULL into the optional column. Zod's `.optional()` alone keeps '' intact
// because it's still a valid string.
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

export const quotationCreateSchema = z.object({
  totalOrderValuePaise: z
    .number()
    .int('Amount must be a whole number of paise')
    .positive('Amount must be greater than zero')
    .max(MAX_PAISE, 'Amount exceeds the maximum allowed'),
  quotationNumber: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(100).optional(),
  ),
  notes: z.preprocess(
    blankToUndefined,
    z.string().trim().max(2000, 'Notes cannot exceed 2000 characters').optional(),
  ),
});

export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;

// Upsert payload is identical — server decides create vs update by
// looking up the existing quotation row.
export const quotationUpsertSchema = quotationCreateSchema;
export type QuotationUpsertInput = QuotationCreateInput;
