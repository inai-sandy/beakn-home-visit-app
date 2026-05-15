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
