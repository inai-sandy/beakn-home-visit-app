import { z } from 'zod';

import {
  REASON_REQUIRES_NOTE,
  REJECTION_REASON_CODES,
  type RejectionReason,
} from '@/lib/rejection-reasons';

// =============================================================================
// HVA-69: validator for POST /api/requests/[id]/mark-customer-rejected
// =============================================================================
//
// Two fields:
//   - reason: one of the six closed-set RejectionReason codes (required).
//   - note: optional free-text context, max 500 chars trimmed.
//
// CROSS-FIELD RULE: when reason='OTHER', note becomes REQUIRED (min 10
// chars after trim). That captures the otherwise-lost specificity.
//
// `z.enum` reads the codes array from rejection-reasons.ts so adding a
// new code is a one-line change there — no parallel update needed here.
// =============================================================================

const NOTE_MAX = 500;
const OTHER_NOTE_MIN = 10;

export const markCustomerRejectedSchema = z
  .object({
    reason: z.enum(REJECTION_REASON_CODES as [RejectionReason, ...RejectionReason[]], {
      message: 'Pick a reason for the rejection.',
    }),
    note: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return undefined;
        if (typeof v !== 'string') return v;
        const t = v.trim();
        return t === '' ? undefined : t;
      },
      z.string().max(NOTE_MAX, `Note must be ${NOTE_MAX} characters or fewer.`).optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (REASON_REQUIRES_NOTE.has(data.reason)) {
      const length = data.note?.length ?? 0;
      if (length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'When reason is "Other", a note is required.',
        });
      } else if (length < OTHER_NOTE_MIN) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: `Note must be at least ${OTHER_NOTE_MIN} characters when reason is "Other".`,
        });
      }
    }
  });

export type MarkCustomerRejectedInput = z.infer<typeof markCustomerRejectedSchema>;
