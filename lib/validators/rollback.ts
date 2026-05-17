import { z } from 'zod';

// =============================================================================
// HVA-141: validator for POST /api/requests/[id]/rollback
// =============================================================================
//
// Reason is OPTIONAL per Sandeep's locked decision. Empty / whitespace
// reasons normalise to null on the server so audit + history rows stay
// consistent. Cap at 500 chars to match the client textarea.
// =============================================================================

export const rollbackSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be 500 characters or fewer.')
    .optional()
    .transform((v) => {
      if (v === undefined) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});

export type RollbackInput = z.infer<typeof rollbackSchema>;
