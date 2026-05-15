import { z } from 'zod';

// =============================================================================
// HVA-31: customer visit-request form schema (public /request)
// =============================================================================
//
// Source of truth for /request form validation, both client-side via
// react-hook-form's zodResolver and server-side once HVA-33 wires the submit
// Server Action (today the action is a no-op toast — see app/request/request-
// form.tsx). Field order + rules track spec §1.2 verbatim.
//
// CITIES list:
// Hard-coded inline below until the `cities` table is seeded. The table
// already exists in the DB (HVA-14 schema) but is empty in this environment.
// TODO: source from `cities` table once seeded. Linear HVA-31's body referred
// to "HVA-87" for the seeding, but that ticket is the Admin notification
// system, not cities. Track the actual seeding work under a separate ticket
// when it lands; until then this const stays authoritative.
//
// PHONE rule:
// Indian mobile = 10 digits, first digit 6-9. Stored at submit time as
// "+91"+digits — the form collects only the 10-digit half; the +91 adornment
// is visible-but-non-editable in the UI.
// =============================================================================

export const ALLOWED_CITIES = [
  'Hyderabad',
  'Bangalore',
  'Chennai',
  'Ahmedabad',
  'Vizag',
  'Vijayawada',
  'Mumbai',
  'Pune',
  'Other',
] as const;
export type AllowedCity = (typeof ALLOWED_CITIES)[number];

// City → state default. Used by the form to auto-fill the State field on
// city selection. User can still edit the auto-filled value (the State
// field is plain text, not locked).
export const CITY_TO_STATE: Record<AllowedCity, string> = {
  Hyderabad: 'Telangana',
  Bangalore: 'Karnataka',
  Chennai: 'Tamil Nadu',
  Ahmedabad: 'Gujarat',
  Vizag: 'Andhra Pradesh',
  Vijayawada: 'Andhra Pradesh',
  Mumbai: 'Maharashtra',
  Pune: 'Maharashtra',
  Other: '',
};

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
  city: z.enum(ALLOWED_CITIES, {
    message: 'Select a city',
  }),
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
});

export type CustomerRequestInput = z.infer<typeof customerRequestSchema>;
