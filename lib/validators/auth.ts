import { z } from 'zod';

// Login form input — HVA-23.
// Phone is a bare 10-digit Indian mobile number (no +91 prefix; UI shows the
// prefix as a static adornment, app prepends it on submission to Better-Auth).
// Password: >=8 chars (the floor from spec §2.2 + HVA-24 brief). Real strength
// rules are enforced server-side at sign-up; this is sign-in only, so the
// minimum is just a sanity check before round-tripping to the server.

export const loginSchema = z.object({
  phone: z
    .string()
    .regex(/^[0-9]{10}$/, '10-digit Indian mobile number required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Default ON is set by react-hook-form's `defaultValues`, not here. In Zod 4,
  // `.default(true)` makes the input optional which breaks `zodResolver` typing
  // because RHF demands a single shape for both input + output.
  rememberMe: z.boolean(),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Set-password form input — HVA-26 (mandatory first-login change).
// No `currentPassword`: the user just logged in with an admin-issued temp,
// and the server action verifies session ownership + must_change_password
// gate before flipping the hash. Validation rules verbatim from Linear AC:
// ≥8 chars, ≥1 digit, ≥1 letter, new === confirm.
export const setPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[0-9]/, 'Must contain at least one digit')
      .regex(/[a-zA-Z]/, 'Must contain at least one letter'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

// Change-password form input — HVA-29 (user-initiated change from Profile).
// Unlike setPasswordSchema (HVA-26, first-login flow), this requires the
// user to type their current password. Validation rules verbatim from
// Linear AC:
//   - new password: ≥8 chars, ≥1 digit, ≥1 letter (same as HVA-26)
//   - confirm === new
//   - new !== current (block trivial reuse of the same password)
// All three rules surface as inline field errors when react-hook-form
// runs in onChange/onTouched mode.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[0-9]/, 'Must contain at least one digit')
      .regex(/[a-zA-Z]/, 'Must contain at least one letter'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine(
    (data) =>
      data.currentPassword.length === 0 ||
      data.newPassword.length === 0 ||
      data.currentPassword !== data.newPassword,
    {
      message: 'New password must be different from current password',
      path: ['newPassword'],
    },
  );

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
