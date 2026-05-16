import { auth } from '@/lib/auth';

// =============================================================================
// HVA-101: auth helpers — programmatic sign-in via Better-Auth's server API
// =============================================================================
//
// Better-Auth ships `auth.api.*` methods callable in-process (no HTTP). We
// use signInPhoneNumber() against a user we just seeded — bypassing the
// /api/auth/sign-in/phone-number endpoint entirely. This keeps tests fast
// and avoids needing a running Next.js dev server.
//
// SESSION SHAPE:
//   signInPhoneNumber({ body }, { returnHeaders: true }) returns the
//   newly-minted session token + a Headers map with the Set-Cookie line.
//   For tests that just want "is this caller authenticated as role X" we
//   only need the token; proxy-level tests that look at cookies use
//   buildAuthHeaders() to construct the Cookie header.
//
// PHONE-NUMBER PLUGIN QUIRKS (no test-mode bypass — documented for future
// readers):
//   - The plugin does NOT auto-verify phones; we seed phoneVerified=true
//     in the helper (tests/helpers/db.ts seedUser default).
//   - Sign-in calls hashPassword() with scrypt; matches our seed
//     helper's password hashing. Slow (~80ms/call) but correct.
//   - There is no env-flag to skip rate-limit checks — the rate_limits
//     table is truncated between tests by per-file.ts.
// =============================================================================

export interface AuthedSession {
  userId: string;
  token: string;
  /** Pre-built Cookie header ready to pass to a proxy() call. */
  cookieHeader: string;
}

export async function loginByPhone(
  phoneNumber: string,
  password: string,
): Promise<AuthedSession> {
  // `returnHeaders: true` puts the Set-Cookie header on the response —
  // we extract it and rewrap as a Cookie header for outbound use.
  const result = await auth.api.signInPhoneNumber({
    body: { phoneNumber, password },
    returnHeaders: true,
  });

  if (!result || !result.response || !('token' in result.response)) {
    throw new Error('signInPhoneNumber returned no session');
  }

  const setCookie = result.headers.get('set-cookie') ?? '';
  // Set-Cookie may include attribute pairs after the first `;`. The Cookie
  // request header only needs name=value.
  const cookieHeader = setCookie
    .split(',')
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');

  return {
    userId: (result.response as { user: { id: string } }).user.id,
    token: (result.response as { token: string }).token,
    cookieHeader,
  };
}
