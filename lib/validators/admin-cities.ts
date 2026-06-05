import { z } from 'zod';

// =============================================================================
// HVA-110 + HVA-90: validators for /admin/settings/organization/cities PATCH
// =============================================================================
//
// HVA-110 shipped with one editable column: `captain_routing_email`.
// HVA-90 (this update) adds two more — `discord_webhook_url` and
// `other_routing_email` — and ships a multi-field PATCH where each
// field is optional. Clients only send the fields they want to change;
// the server treats an absent field as "no change to this column."
//
// Per-column normalisation:
//   - captainRoutingEmail  → email | null (HVA-110 contract preserved)
//   - otherRoutingEmail    → email | null (only valid on the "Other" row)
//   - discordWebhookUrl    → URL string | null. Server then live-pings
//                            Discord via lib/admin/discord-webhook-validator.
//
// =============================================================================

const emailOrNullPreprocessor = z.preprocess(
  (v) => {
    // Absent (key omitted) → undefined → schema treats as "no change."
    if (v === undefined) return undefined;
    // Explicit null OR empty/whitespace string → null → schema treats as "clear column."
    if (v === null) return null;
    if (typeof v === 'string') {
      const t = v.trim();
      return t === '' ? null : t.toLowerCase();
    }
    return v;
  },
  z.union([
    z.string().email('Enter a valid email address').max(255),
    z.null(),
  ]),
);

const webhookOrNullPreprocessor = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v === 'string') {
      const t = v.trim();
      return t === '' ? null : t;
    }
    return v;
  },
  z.union([
    z
      .string()
      .url('Enter a valid URL (https://discord.com/api/webhooks/...)')
      .max(500),
    z.null(),
  ]),
);

// HVA-110 single-field schema kept for back-compat — old clients that
// PATCH just the routing email continue to work without code changes.
export const cityRoutingEmailUpdateSchema = z.object({
  captainRoutingEmail: emailOrNullPreprocessor,
});

export type CityRoutingEmailUpdateInput = z.infer<
  typeof cityRoutingEmailUpdateSchema
>;

// HVA-90 multi-field schema. Every field is optional; only included
// fields are written. `.partial()` would leave the preprocessors in
// place, but `z.object` with three explicit `.optional()` fields is
// the most legible shape for callers reading the type.
export const cityConfigUpdateSchema = z.object({
  captainRoutingEmail: emailOrNullPreprocessor.optional(),
  otherRoutingEmail: emailOrNullPreprocessor.optional(),
  discordWebhookUrl: webhookOrNullPreprocessor.optional(),
});

export type CityConfigUpdateInput = z.infer<typeof cityConfigUpdateSchema>;
