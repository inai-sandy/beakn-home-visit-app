import { z } from 'zod';

// =============================================================================
// HVA-137: validators for captain approval gate
// =============================================================================
//
// Approve route: optional note (≤ 500 chars). Reject route: mandatory
// reason (50–500 chars, same shape as HVA-140 reassign — accountability
// matters when sending a job back to the exec).
// =============================================================================

export const approveSchema = z.object({
  note: z
    .string()
    .trim()
    .max(500, 'Note must be 500 characters or fewer.')
    .optional()
    .transform((v) => {
      if (v === undefined) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});

export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(50, 'Reason must be at least 50 characters.')
    .max(500, 'Reason must be 500 characters or fewer.'),
});

export type ApproveInput = z.infer<typeof approveSchema>;
export type RejectInput = z.infer<typeof rejectSchema>;
