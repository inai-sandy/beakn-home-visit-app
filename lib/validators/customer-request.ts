import { z } from 'zod';

// =============================================================================
// HVA-31: customer visit-request form schema (public /request)
// =============================================================================
//
// Source of truth for /request form validation, both client-side via
// react-hook-form's zodResolver and server-side via /api/customer-request.
// Field order + rules track spec §1.2 verbatim.
//
// CITIES list (HVA-100): the inline `ALLOWED_CITIES` + `CITY_TO_STATE`
// consts that HVA-31 used were removed when the `cities` table seed
// migration landed (HVA-33). The dropdown options + state auto-fill
// come from `lib/cities-list.ts > getCitiesForRequestForm()`. The Zod
// `city` field accepts any trimmed non-empty string; the server route
// resolves it to a `cities.id` via a name lookup (returning 400 +
// fieldErrors.city if the name is unknown).
//
// PHONE rule:
// Indian mobile = 10 digits, first digit 6-9. Stored at submit time as
// "+91"+digits — the form collects only the 10-digit half; the +91 adornment
// is visible-but-non-editable in the UI.
// =============================================================================

export const ALLOWED_BHKS = [
  '1 BHK',
  '2 BHK',
  '3 BHK',
  '4 BHK',
  'Others',
] as const;
export type AllowedBhk = (typeof ALLOWED_BHKS)[number];

export const ALLOWED_INTERESTS = [
  'Automation',
  'Motorized Curtains',
  'Complete Lighting',
  'All',
] as const;
export type AllowedInterest = (typeof ALLOWED_INTERESTS)[number];

// Indian mobile: 10 digits, first digit 6-9. Form collects only the 10-digit
// half (the +91 adornment is visible but not user-editable). Server-side
// re-validation in HVA-33 should use this same regex.
export const PHONE_DIGITS_REGEX = /^[6-9]\d{9}$/;

export const customerRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters'),
  phone: z
    .string()
    .regex(PHONE_DIGITS_REGEX, 'Enter a valid 10-digit Indian mobile number'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address'),
  address: z
    .string()
    .trim()
    .min(10, 'Address must be at least 10 characters'),
  // HVA-100: city is validated as a free-form non-empty string here.
  // The server route at /api/customer-request resolves the name to a
  // cities.id and rejects unknown names with 400 + fieldErrors.city.
  city: z.string().trim().min(1, 'Select a city'),
  state: z
    .string()
    .trim()
    .min(2, 'State is required'),
  bhk: z.enum(ALLOWED_BHKS, {
    message: 'Select a BHK option',
  }),
  interest: z
    .array(z.enum(ALLOWED_INTERESTS))
    .min(1, 'Select at least one interest'),

  // HVA-32: optional self-reported GPS coordinates from the browser's
  // Geolocation API. Customer-driven; permission denial / non-share leaves
  // these undefined and the form still submits cleanly. Stored verbatim
  // at whatever precision the device returned — NOT rounded to N decimal
  // places (AC #3 in HVA-32). HVA-33 reads them off the validated payload
  // and writes them onto the visit_requests row.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().positive().optional(),

  // HVA-34: Cloudflare Turnstile token, required on submit. Client gets
  // it from the widget's success callback (cf-turnstile-response); server
  // posts it to challenges.cloudflare.com/turnstile/v0/siteverify in
  // lib/turnstile.ts. Empty string fails the .min(1) — the widget hasn't
  // resolved yet — and the submit button on the client is also disabled
  // in that state.
  turnstileToken: z.string().min(1, 'Anti-spam challenge required'),
});

export type CustomerRequestInput = z.infer<typeof customerRequestSchema>;
