import { z } from 'zod';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): dispatch validators
// =============================================================================

const MAX_ITEMS_PER_DISPATCH = 50;
const MAX_QTY_PER_LINE = 100_000;
const MAX_NOTES = 2000;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

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
});

export type DispatchCreateInput = z.input<typeof dispatchCreateSchema>;
