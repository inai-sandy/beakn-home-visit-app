// =============================================================================
// Better-Auth configuration — HVA-24
// =============================================================================
//
// Single source of truth for the auth instance. The catch-all route handler
// at app/api/auth/[...all]/route.ts forwards every /api/auth/* HTTP request
// to `auth.handler`. Server Components / Server Actions use
// `getServerSession()` from lib/auth-server.ts.
//
// Architectural choices (locked in the HVA-24 brief; see PR description for
// rationale):
//   - phone+password (not OTP). OTP is wired in a later issue.
//   - DB-backed sessions (not JWT). Sliding expiration, 30 days.
//   - Drizzle adapter over our existing postgres-js client.
//   - Cookies: HttpOnly + Secure + SameSite=Lax. Domain is inferred from
//     BETTER_AUTH_URL (https://visits.beakn.in).
//   - Rate limit: 5 attempts per phone per 15 min for /sign-in/phone-number.
//
// Deviations from the originally-locked decisions (documented in the PR):
//   1. PASSWORD STORAGE LOCATION: Better-Auth keeps password in the `accounts`
//      table (one row per provider, providerId="credential"), not on users.
//      The HVA-24 brief said "add password_hash to users" — that's incorrect
//      against BA's actual model. Following the library.
//   2. HASH ALGORITHM: BA's default is scrypt (Node built-in). The
//      phone-number plugin doesn't expose a custom hasher hook (only
//      emailAndPassword does). argon2id was the locked choice; accepting
//      scrypt rather than forking BA's internals. Scrypt is OWASP-listed
//      as acceptable; the password column can be re-hashed in-place if/when
//      argon2id support lands.
//   3. ROLE STRING: locked at `sales_executive` (HVA-14 schema), not
//      `sales_exec` from the HVA-24 issue body — flagged in HVA-14 comments.
// =============================================================================

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { phoneNumber } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { accounts, rateLimits, sessions, users, verifications } from '@/db/schema';

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is not set');
}

export const auth = betterAuth({
  appName: 'Beakn',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'https://visits.beakn.in',
  trustedOrigins: ['https://visits.beakn.in'],

  database: drizzleAdapter(db, {
    provider: 'pg',
    // Schema keys MUST match the resolved modelName below (plural to match
    // HVA-14's table-naming convention). BA's adapter uses these keys for
    // table lookup; mismatched keys give a confusing "model X not found"
    // error at the first sign-in attempt.
    schema: {
      users,
      sessions,
      accounts,
      verifications,
      rateLimit: rateLimits,
    },
  }),

  // Email + password is disabled — we authenticate via the phone-number plugin.
  emailAndPassword: { enabled: false },

  user: {
    modelName: 'users',
    // BA core expects `name`; we map to our existing fullName column. The TS
    // field is `fullName` (snake_case `full_name` at the DB level), so BA's
    // `fields.name` points at "fullName".
    fields: {
      name: 'fullName',
    },
    additionalFields: {
      role: { type: 'string', required: true, input: false },
      phone: { type: 'string', required: true, input: false },
      isActive: { type: 'boolean', defaultValue: true, input: false },
      mustChangePassword: { type: 'boolean', defaultValue: true, input: false },
      failedLoginAttempts: { type: 'number', defaultValue: 0, input: false },
      lockedUntil: { type: 'date', required: false, input: false },
      lastLoginAt: { type: 'date', required: false, input: false },
    },
  },

  session: {
    modelName: 'sessions',
    expiresIn: 60 * 60 * 24 * 30, // 30 days, per HVA-23 Remember Me default
    updateAge: 60 * 60 * 24, // sliding: refresh once per day of use
    cookieCache: {
      enabled: false, // hit DB every request so role/lockout/audit are real-time
    },
  },

  account: { modelName: 'accounts' },
  verification: { modelName: 'verifications' },

  databaseHooks: {
    session: {
      create: {
        // Block re-login for deactivated users. Deactivating a user
        // revokes their existing sessions, but nothing stopped them from
        // signing in again and minting a fresh one with their unchanged
        // password. Every sign-in path (phone-number plugin today, OTP
        // later) ends in a session insert, so gating session creation is
        // the single choke point that covers them all. Throwing here
        // aborts the sign-in with 403 and no session row is written.
        before: async (session) => {
          const [u] = await db
            .select({ isActive: users.isActive })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
          if (!u || !u.isActive) {
            throw new APIError('FORBIDDEN', {
              message:
                'This account has been deactivated. Contact your administrator.',
            });
          }
        },
      },
    },
  },

  advanced: {
    // Our id columns are `uuid` with DB-side `uuid_generate_v7()` defaults
    // (locked in HVA-14). BA's default is a CUID-like string that Postgres
    // rejects. Setting generateId: false makes BA omit the id field on insert;
    // Postgres fills it via DEFAULT. Keeps every row sortable + matches the
    // rest of the schema.
    database: { generateId: false },
    cookies: {
      session_token: {
        attributes: {
          sameSite: 'lax',
          secure: true,
          httpOnly: true,
        },
      },
    },
  },

  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60 * 15, // 15-min rolling window
    max: 100, // generic cap on auth endpoints
    customRules: {
      // 5 was too aggressive for legitimate admin testing (logging in as
      // multiple roles from the same IP within a short window). Bumped
      // to 20 — still well below brute-force territory + leaves room
      // for genuine retry while admins debug a forgotten password.
      '/sign-in/phone-number': { window: 60 * 15, max: 20 },
    },
  },

  plugins: [
    phoneNumber({
      // sendOTP is required by the plugin's TS signature even when we don't
      // use OTP. Real SMS provider integration lands in the OTP issue
      // (HVA-?? Interakt/WhatsApp); password-only login never invokes this.
      sendOTP: async () => {},
      requireVerification: false,
      schema: {
        user: {
          fields: {
            phoneNumber: 'phone',
            phoneNumberVerified: 'phoneVerified',
          },
        },
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
