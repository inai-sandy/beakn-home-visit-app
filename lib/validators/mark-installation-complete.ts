import { z } from 'zod';

// =============================================================================
// HVA-68: body validator for /api/requests/[id]/mark-installation-complete
// =============================================================================
//
// The action takes one optional field: a free-text note from the exec
// describing what was installed / any caveats. The note is stored on
// `request_status_history.reason` (existing column) and echoed into the
// audit_log afterState; no new column on visit_requests.
//
// Server-side trim + max 500 chars. Client UI also caps the textarea, but
// trusting the client alone would let any curl request blow past it.
// Empty string + omitted both normalise to undefined so the route can
// fall through with no `reason` parameter.
// =============================================================================

export const markInstallationCompleteSchema = z.object({
  note: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return undefined;
      if (typeof v !== 'string') return v;
      const t = v.trim();
      return t === '' ? undefined : t;
    },
    z.string().max(500, 'Note must be 500 characters or fewer.').optional(),
  ),
});

export type MarkInstallationCompleteInput = z.infer<
  typeof markInstallationCompleteSchema
>;
