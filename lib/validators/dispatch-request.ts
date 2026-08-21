import { z } from 'zod';

// =============================================================================
// HVA-342: exec dispatch-request validators
// =============================================================================
//
// The exec picks line items off their own pending list, so the payload is
// ids and quantities — there is no product name to validate, which is the
// whole point of the ticket. Anything typed here (the message, the date) is
// commentary support reads, never something the numbers depend on.
// =============================================================================

const MAX_ITEMS_PER_REQUEST = 100;
const MAX_QTY_PER_LINE = 100_000;
const MAX_MESSAGE = 2000;
const MAX_REASON = 500;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

export const dispatchRequestItemInputSchema = z.object({
  lineItemId: z.string().uuid('Invalid line item id'),
  qty: z
    .number()
    .int('Quantity must be a whole number')
    .positive('Quantity must be > 0')
    .max(MAX_QTY_PER_LINE, `Quantity exceeds the cap of ${MAX_QTY_PER_LINE}`),
});

export const dispatchRequestCreateSchema = z.object({
  items: z
    .array(dispatchRequestItemInputSchema)
    .min(1, 'Pick at least one product')
    .max(
      MAX_ITEMS_PER_REQUEST,
      `A request can include at most ${MAX_ITEMS_PER_REQUEST} products`,
    ),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  // YYYY-MM-DD. Optional: an exec who needs stock "whenever" should not have
  // to invent a date, and a made-up date is worse than none for support's
  // sequencing.
  requiredByDate: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
  ),
  message: z.preprocess(
    blankToUndefined,
    z.string().trim().max(MAX_MESSAGE, 'Message too long').optional(),
  ),
});

export type DispatchRequestCreateInput = z.input<
  typeof dispatchRequestCreateSchema
>;

/**
 * Support's decision on ONE order group.
 *
 * `reason` is required for reject and hold, and ignored for approve. An exec
 * who is told "no" or "not yet" without being told why comes back and asks a
 * human, which is the coordination this screen exists to remove.
 */
export const dispatchRequestDecisionSchema = z
  .object({
    orderGroupId: z.string().uuid('Invalid order group id'),
    decision: z.enum(['approve', 'hold', 'reject']),
    reason: z.preprocess(
      blankToUndefined,
      z.string().trim().max(MAX_REASON, 'Reason too long').optional(),
    ),
    courierName: z.preprocess(
      blankToUndefined,
      z.string().trim().max(120, 'Courier name too long').optional(),
    ),
    trackingNumber: z.preprocess(
      blankToUndefined,
      z.string().trim().max(100, 'Tracking number too long').optional(),
    ),
  })
  .refine(
    (v) => v.decision === 'approve' || (v.reason?.trim().length ?? 0) > 0,
    { message: 'Give a reason', path: ['reason'] },
  );

export type DispatchRequestDecisionInput = z.input<
  typeof dispatchRequestDecisionSchema
>;
