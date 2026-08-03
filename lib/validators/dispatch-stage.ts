import { z } from 'zod';

// HVA-239: dispatch stage advance validator
// HVA-304: 'delivered' appended — see below.

export const DISPATCH_STAGES = [
  'created',
  'packed',
  'handed_off',
  'delivered',
] as const;
export type DispatchStage = (typeof DISPATCH_STAGES)[number];

// Lookup: given the current stage, what's the next legal stage?
export const NEXT_STAGE: Partial<Record<DispatchStage, DispatchStage>> = {
  created: 'packed',
  packed: 'handed_off',
  // HVA-304: handed_off means "given to the courier"; delivered means the
  // customer actually has it. Without the second state the exec can only
  // answer "has it shipped", never "has my customer received it".
  handed_off: 'delivered',
  // delivered is terminal.
};

/**
 * Stages at which the package is no longer moving through our hands.
 *
 * IMPORTANT: anything deriving "is this shipment still open" must treat
 * BOTH of these as closed. Before HVA-304 that check was a bare
 * `stage <> 'handed_off'`; leaving it that way makes every delivered
 * shipment look open, which drags fully-completed orders back into
 * `in_progress` across the support queue, the support orders list and the
 * exec/captain dispatch pill.
 */
export const CLOSED_DISPATCH_STAGES: readonly DispatchStage[] = [
  'handed_off',
  'delivered',
];

/** SQL literal list for the closed stages, e.g. `'handed_off','delivered'`.
 *  Keeps the raw-SQL "open dispatch" predicates in lib/support/* honest —
 *  add a closed stage here and both call sites follow automatically. */
export const CLOSED_DISPATCH_STAGES_SQL = CLOSED_DISPATCH_STAGES.map(
  (s) => `'${s}'`,
).join(',');

export const advanceDispatchStageSchema = z.object({
  dispatchId: z.string().uuid('Invalid dispatch id'),
  toStage: z.enum(['packed', 'handed_off', 'delivered']),
});
export type AdvanceDispatchStageInput = z.input<typeof advanceDispatchStageSchema>;
