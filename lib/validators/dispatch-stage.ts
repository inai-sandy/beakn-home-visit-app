import { z } from 'zod';

// HVA-239: dispatch stage advance validator

export const DISPATCH_STAGES = ['created', 'packed', 'handed_off'] as const;
export type DispatchStage = (typeof DISPATCH_STAGES)[number];

// Lookup: given the current stage, what's the next legal stage?
export const NEXT_STAGE: Partial<Record<DispatchStage, DispatchStage>> = {
  created: 'packed',
  packed: 'handed_off',
  // handed_off is terminal in v1
};

export const advanceDispatchStageSchema = z.object({
  dispatchId: z.string().uuid('Invalid dispatch id'),
  toStage: z.enum(['packed', 'handed_off']),
});
export type AdvanceDispatchStageInput = z.input<typeof advanceDispatchStageSchema>;
