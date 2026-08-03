import { z } from 'zod';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): dispatch validators
// =============================================================================

const MAX_ITEMS_PER_DISPATCH = 50;
const MAX_QTY_PER_LINE = 100_000;
const MAX_NOTES = 2000;

const MAX_COURIER_NAME = 120;
const MAX_TRACKING_NUMBER = 100;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

// HVA-303: shared by create + update so the two paths can never drift on
// what counts as a valid courier entry.
const courierFields = {
  courierName: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(MAX_COURIER_NAME, 'Courier name too long')
      .optional(),
  ),
  trackingNumber: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(MAX_TRACKING_NUMBER, 'Tracking number too long')
      .optional(),
  ),
};

export const dispatchItemInputSchema = z.object({
  lineItemId: z.string().uuid('Invalid line item id'),
  qty: z
    .number()
    .int('Quantity must be a whole number')
    .positive('Quantity must be > 0')
    .max(MAX_QTY_PER_LINE, `Quantity exceeds the cap of ${MAX_QTY_PER_LINE}`),
});

export const dispatchCreateSchema = z.object({
  items: z
    .array(dispatchItemInputSchema)
    .min(1, 'At least one item is required')
    .max(
      MAX_ITEMS_PER_DISPATCH,
      `A single dispatch can include at most ${MAX_ITEMS_PER_DISPATCH} items`,
    ),
  notes: z.preprocess(
    blankToUndefined,
    z.string().trim().max(MAX_NOTES, 'Notes too long').optional(),
  ),
  ...courierFields,
});

export type DispatchCreateInput = z.input<typeof dispatchCreateSchema>;

// =============================================================================
// HVA-303: courier details
// =============================================================================
//
// Both optional at creation. Support frequently records the dispatch before
// the courier is booked, and the tracking number is usually only known at
// handoff — so `updateDispatchTrackingSchema` exists to fill them in later
// rather than forcing a guess up front.
//
// Plain strings, no format validation: AWB formats differ per courier and a
// regex here would only reject valid numbers.
// =============================================================================

export const updateDispatchTrackingSchema = z.object({
  dispatchId: z.string().uuid('Invalid dispatch id'),
  ...courierFields,
});

export type UpdateDispatchTrackingInput = z.input<
  typeof updateDispatchTrackingSchema
>;
