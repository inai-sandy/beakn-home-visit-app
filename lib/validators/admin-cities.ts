import { z } from 'zod';

// =============================================================================
// HVA-110: validators for /admin/settings/organization/cities PATCH endpoint
// =============================================================================
//
// Only one editable column in this ship: captain_routing_email. The field
// accepts a valid RFC 5322 email or blank/null (blank resets to NULL,
// which triggers HVA-42's [UNROUTED] fallback path).
//
// The schema accepts string | null | undefined and normalises to one of:
//   - string (trimmed, lowercased) when an email was provided
//   - null when the user blanked the field
//
// Done via preprocess so the same shape works whether the client sends
// `{}`, `{captainRoutingEmail: ''}`, `{captainRoutingEmail: null}`, or
// a real email.
// =============================================================================

export const cityRoutingEmailUpdateSchema = z.object({
  captainRoutingEmail: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string') {
        const t = v.trim();
        return t === '' ? null : t.toLowerCase();
      }
      return v;
    },
    z
      .union([
        z.string().email('Enter a valid email address').max(255),
        z.null(),
      ]),
  ),
});

export type CityRoutingEmailUpdateInput = z.infer<
  typeof cityRoutingEmailUpdateSchema
>;
