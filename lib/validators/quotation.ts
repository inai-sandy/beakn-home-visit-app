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

// =============================================================================
// HVA-234 (HVA-231 Phase 1.0): line item validators
// =============================================================================

const PRIORITY_VALUES = ['low', 'med', 'high'] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QTY = 100_000; // sanity cap; 1 lakh units is way past any real order

const dateStringOrNull = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(ISO_DATE_RE, 'Target date must be YYYY-MM-DD')
    .optional(),
);

const gstPercentOrNull = z.preprocess(
  blankToUndefined,
  z
    .number()
    .min(0, 'GST percent cannot be negative')
    .max(100, 'GST percent cannot exceed 100')
    .optional(),
);

const productSkuOrNull = z.preprocess(
  blankToUndefined,
  z.string().trim().max(128, 'SKU too long').optional(),
);

const itemNotesOrNull = z.preprocess(
  blankToUndefined,
  z.string().trim().max(2000, 'Notes cannot exceed 2000 characters').optional(),
);

// Server enforces line_total_paise = quantity * unit_price_paise.
// Client can send it for display but we always recompute to prevent
// tampering / drift.
export const lineItemCreateSchema = z.object({
  quotationId: z.string().uuid('Invalid quotation id'),
  productName: z
    .string()
    .trim()
    .min(1, 'Product name is required')
    .max(255, 'Product name too long'),
  productSku: productSkuOrNull,
  quantity: z
    .number()
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than zero')
    .max(MAX_QTY, `Quantity exceeds the cap of ${MAX_QTY}`),
  unitPricePaise: z
    .number()
    .int('Unit price must be paise (integer)')
    .min(0, 'Unit price cannot be negative')
    .max(MAX_PAISE, 'Unit price exceeds the maximum allowed'),
  gstPercent: gstPercentOrNull,
  notes: itemNotesOrNull,
  priority: z.enum(PRIORITY_VALUES).default('med'),
  targetDispatchDate: dateStringOrNull,
});

export type LineItemCreateInput = z.infer<typeof lineItemCreateSchema>;

// Update is the same payload minus quotationId (the row already belongs
// to a quotation; can't move it). All fields optional — server merges
// against the existing row, but at least one field must be provided.
export const lineItemUpdateSchema = z
  .object({
    itemId: z.string().uuid('Invalid line item id'),
    productName: z
      .string()
      .trim()
      .min(1, 'Product name is required')
      .max(255, 'Product name too long')
      .optional(),
    productSku: productSkuOrNull,
    quantity: z
      .number()
      .int('Quantity must be a whole number')
      .positive('Quantity must be greater than zero')
      .max(MAX_QTY, `Quantity exceeds the cap of ${MAX_QTY}`)
      .optional(),
    unitPricePaise: z
      .number()
      .int('Unit price must be paise (integer)')
      .min(0, 'Unit price cannot be negative')
      .max(MAX_PAISE, 'Unit price exceeds the maximum allowed')
      .optional(),
    gstPercent: gstPercentOrNull,
    notes: itemNotesOrNull,
    priority: z.enum(PRIORITY_VALUES).optional(),
    targetDispatchDate: dateStringOrNull,
  })
  .refine(
    (v) =>
      v.productName !== undefined ||
      v.productSku !== undefined ||
      v.quantity !== undefined ||
      v.unitPricePaise !== undefined ||
      v.gstPercent !== undefined ||
      v.notes !== undefined ||
      v.priority !== undefined ||
      v.targetDispatchDate !== undefined,
    { message: 'No fields to update' },
  );

export type LineItemUpdateInput = z.infer<typeof lineItemUpdateSchema>;

// Focused setter for priority + target date — used by the exec's
// per-row priority UI without re-validating the rest of the item.
export const lineItemPrioritySchema = z.object({
  itemId: z.string().uuid('Invalid line item id'),
  priority: z.enum(PRIORITY_VALUES),
  targetDispatchDate: dateStringOrNull,
});

export type LineItemPriorityInput = z.infer<typeof lineItemPrioritySchema>;
