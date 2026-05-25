import { z } from 'zod';

// =============================================================================
// HVA-39: validator for POST /api/track/[token]/cancel
// =============================================================================
//
// Customer-initiated cancellation. The customer is unauthenticated; the
// tracking_token (nanoid(21)) in the URL is the credential. The reason
// taxonomy is intentionally narrower than the exec/captain rejection
// reasons (lib/rejection-reasons.ts) — customers see only friendly,
// customer-facing codes via lib/cancellation-reasons.ts plus an "Other"
// escape hatch that requires a free-text note.
// =============================================================================

export const TRACK_CANCEL_REASON_CODES = [
  'NO_LONGER_INTERESTED',
  'OUT_OF_SERVICE_AREA',
  'DUPLICATE_REQUEST',
  'OTHER',
] as const;

export type TrackCancelReason = (typeof TRACK_CANCEL_REASON_CODES)[number];

export const TRACK_CANCEL_REASON_LABELS: Record<TrackCancelReason, string> = {
  NO_LONGER_INTERESTED: 'No longer interested',
  OUT_OF_SERVICE_AREA: 'Outside your service area',
  DUPLICATE_REQUEST: 'Duplicate of another request',
  OTHER: 'Other (please tell us why)',
};

const NOTE_MAX = 500;
const OTHER_NOTE_MIN = 10;

export const trackCancelSchema = z
  .object({
    reason: z.enum(
      [...TRACK_CANCEL_REASON_CODES] as unknown as [
        TrackCancelReason,
        ...TrackCancelReason[],
      ],
      {
        message: 'Pick a reason for the cancellation.',
      },
    ),
    note: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return undefined;
        if (typeof v !== 'string') return v;
        const t = v.trim();
        return t === '' ? undefined : t;
      },
      z
        .string()
        .max(NOTE_MAX, `Note must be ${NOTE_MAX} characters or fewer.`)
        .optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.reason === 'OTHER') {
      const length = data.note?.length ?? 0;
      if (length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'When reason is "Other", please tell us why.',
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

export type TrackCancelInput = z.infer<typeof trackCancelSchema>;
