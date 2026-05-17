import { z } from 'zod';

// =============================================================================
// HVA-140: validator for POST /api/requests/[id]/reassign
// =============================================================================
//
// Reason is MANDATORY (50-500 chars). Different shape from HVA-141
// rollback (optional reason) — captain reassigning a request affects
// two execs + the customer's perception of continuity, so accountability
// matters.
// =============================================================================

export const reassignSchema = z.object({
  newExecUserId: z.string().uuid('newExecUserId must be a valid UUID'),
  reason: z
    .string()
    .trim()
    .min(50, 'Reason must be at least 50 characters.')
    .max(500, 'Reason must be 500 characters or fewer.'),
});

export type ReassignInput = z.infer<typeof reassignSchema>;
