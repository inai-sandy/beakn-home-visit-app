import { z } from 'zod';

import {
  ALLOWED_INTERESTS,
  PHONE_DIGITS_REGEX,
} from './customer-request';

// =============================================================================
// HVA-73: Lead capture validation
// =============================================================================
//
// Two-variant schema gated on `type` ('Customer' | 'Business') using Zod's
// discriminated union. Customer leads accept an optional bhk; business
// leads require firmName + businessTypeId. Both share name/phone/email/
// city/interest/notes.
//
// Phone: stored on the wire as a 10-digit string (no +91), mirroring the
// customer-request schema. The server prepends '+91' on write, same as
// the /api/customer-request route does for public submissions.
//
// Interest: 1..N tags from ALLOWED_INTERESTS (the same set the customer
// form uses) — so a converted lead's interest array is valid for the
// downstream visit_requests INSERT without any remapping.
// =============================================================================

// Lead BHK enum matches the visit_requests pgEnum exactly (no space).
// Customer-request form uses '1 BHK' with a space and strips on insert;
// leads store/use the enum value verbatim to avoid the dance.
export const LEAD_BHK_VALUES = ['1BHK', '2BHK', '3BHK', '4BHK', 'Others'] as const;
export type LeadBhk = (typeof LEAD_BHK_VALUES)[number];

// 2026-05-26 universal no-mandate (constrained by DB NOT NULL): name +
// phone + cityId stay required (the latter because leads.city_id is
// NOT NULL). Interest is demoted to optional (min(1) lifted) — exec
// can capture without naming an interest category up front.
const baseFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  phone: z
    .string()
    .regex(PHONE_DIGITS_REGEX, 'Enter a valid 10-digit Indian mobile number'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  cityId: z.string().uuid('Select a city'),
  interest: z.array(z.enum(ALLOWED_INTERESTS)).optional().default([]),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal('').transform(() => undefined)),
};

const customerLeadSchema = z.object({
  type: z.literal('Customer'),
  ...baseFields,
  bhk: z.enum(LEAD_BHK_VALUES).optional(),
});

const businessLeadSchema = z.object({
  type: z.literal('Business'),
  ...baseFields,
  firmName: z
    .string()
    .trim()
    .min(2, 'Firm name must be at least 2 characters')
    .max(100),
  businessTypeId: z.string().uuid('Select a business type'),
});

export const leadSchema = z.discriminatedUnion('type', [
  customerLeadSchema,
  businessLeadSchema,
]);

export type LeadInput = z.infer<typeof leadSchema>;

// =============================================================================
// HVA-74: extra fields the exec must supply during Lead → Request conversion
// =============================================================================
//
// The lead's existing fields prefill the conversion form. The exec fills
// in what's missing — at minimum the address (visit_requests.address is
// NOT NULL), plus a BHK (visit_requests.bhk is also NOT NULL but
// lead.bhk is nullable for Business leads). `customerState` is collected
// for parity with the customer-request form; cities also carry a default
// state value the server falls back to.
// =============================================================================

// 2026-05-26: address + bhk stay required (visit needs both; DB NOT NULL
// on visit_requests.bhk). customerState already optional.
export const convertLeadExtraFieldsSchema = z.object({
  address: z
    .string()
    .trim()
    .min(10, 'Address must be at least 10 characters')
    .max(2000),
  bhk: z.enum(LEAD_BHK_VALUES, { message: 'Select a BHK option' }),
  customerState: z.string().trim().min(2).optional(),
});

export type ConvertLeadExtraFieldsInput = z.infer<
  typeof convertLeadExtraFieldsSchema
>;
