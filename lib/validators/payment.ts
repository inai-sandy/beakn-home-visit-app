import { z } from 'zod';

import { PAYMENT_DIRECTION_VALUES, PAYMENT_MODE_VALUES } from '@/lib/payment-modes';

// =============================================================================
// HVA-70: payment validators
// =============================================================================
//
// Spec deviations baked in:
//   * Ad-hoc payments only — no fixed milestone enum.
//   * Direction = inbound|outbound. Outbound (refund) requires
//     captain-of-city or super_admin — RBAC enforced in the route, not here.
//   * Voiding a payment requires a written reason (min 10 chars).
//   * Refund label is REQUIRED (so payment ledger is readable); inbound
//     label is optional.
// =============================================================================

const MAX_PAISE = 100_000_000_000_000; // 1 lakh crore paise

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Date must be in YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), {
    message: 'Date is not a valid calendar date',
  });

const amountPaiseField = z
  .number()
  .int('Amount must be a whole number of paise')
  .positive('Amount must be greater than zero')
  .max(MAX_PAISE, 'Amount exceeds the maximum allowed');

// Normalise blanks to undefined so the route persists NULL.
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const trimmedOptional = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const paymentBaseSchema = z.object({
  amountPaise: amountPaiseField,
  paymentDate: isoDate,
  mode: z.enum(PAYMENT_MODE_VALUES),
  referenceNumber: trimmedOptional(255),
  notes: trimmedOptional(2000),
});

export const inboundPaymentSchema = paymentBaseSchema.extend({
  direction: z.literal('inbound').default('inbound'),
  label: trimmedOptional(255),
});

export const outboundPaymentSchema = paymentBaseSchema.extend({
  direction: z.literal('outbound'),
  // Refunds must carry a human-readable label so the ledger is auditable.
  label: z
    .string()
    .trim()
    .min(5, 'Refund label must be at least 5 characters')
    .max(255, 'Refund label cannot exceed 255 characters'),
});

// Union dispatched on `direction`. Server route inspects direction to
// pick the schema before persisting.
export const paymentSchema = z.discriminatedUnion('direction', [
  inboundPaymentSchema,
  outboundPaymentSchema,
]);

export type PaymentInput = z.infer<typeof paymentSchema>;
export type InboundPaymentInput = z.infer<typeof inboundPaymentSchema>;
export type OutboundPaymentInput = z.infer<typeof outboundPaymentSchema>;

export const PAYMENT_DIRECTIONS_LITERAL = PAYMENT_DIRECTION_VALUES;

export const paymentVoidSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Void reason must be at least 10 characters')
    .max(1000, 'Void reason cannot exceed 1000 characters'),
});

export type PaymentVoidInput = z.infer<typeof paymentVoidSchema>;
