import { z } from 'zod';

// =============================================================================
// HVA-91/92: zod schemas for admin captain/executive CRUD
// =============================================================================
//
// Phone is the 10-digit Indian mobile half (matches HVA-31's customer form
// and HVA-23's login). Server prepends "+91" before INSERT, same as
// HVA-33 does for visit_requests.
// =============================================================================

const PHONE_DIGITS_REGEX = /^[6-9]\d{9}$/;

const fullNameField = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(255);

const phoneField = z
  .string()
  .regex(PHONE_DIGITS_REGEX, '10-digit Indian mobile number (first digit 6–9)');

// Email is optional. Accept omitted, null, or empty string and treat all
// three as "no email." When supplied, validate format + length.
const emailField = z
  .preprocess(
    (v) => {
      if (v === null || v === undefined) return undefined;
      if (typeof v === 'string') {
        const t = v.trim();
        return t === '' ? undefined : t.toLowerCase();
      }
      return v;
    },
    z.string().email('Valid email address required').max(255).optional(),
  );

const uuidField = z.string().uuid();

// CAPTAIN: 1-or-2 cities allowed per Sandeep 2026-05-26. Original spec
// said exactly 2 but in practice some captains start with one city + a
// city is added later (or some cities are temporarily handled by one
// captain only). 0 is still disallowed at creation — a captain with no
// cities can't actually do anything.
export const captainCreateSchema = z.object({
  fullName: fullNameField,
  phone: phoneField,
  email: emailField,
  cityIds: z
    .array(uuidField)
    .min(1, 'Assign at least 1 city')
    .max(2, 'A captain can own at most 2 cities')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Cities must be distinct',
    }),
});
export type CaptainCreateInput = z.infer<typeof captainCreateSchema>;

export const captainEditSchema = z.object({
  fullName: fullNameField,
  phone: phoneField,
  email: emailField,
  // Edit can leave a captain with 0–2 cities (no exactly-2 invariant
  // post-creation — admin may need to unassign before transferring to
  // another captain).
  cityIds: z
    .array(uuidField)
    .max(2, 'A captain can own at most 2 cities')
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Cities must be distinct',
    }),
});
export type CaptainEditInput = z.infer<typeof captainEditSchema>;

// EXECUTIVE: city derives from captain (schema has no city column on
// sales_executives). Body collects captainUserId only.
export const executiveCreateSchema = z.object({
  fullName: fullNameField,
  phone: phoneField,
  email: emailField,
  captainUserId: uuidField,
});
export type ExecutiveCreateInput = z.infer<typeof executiveCreateSchema>;

export const executiveEditSchema = z.object({
  fullName: fullNameField,
  phone: phoneField,
  email: emailField,
  captainUserId: uuidField,
});
export type ExecutiveEditInput = z.infer<typeof executiveEditSchema>;
