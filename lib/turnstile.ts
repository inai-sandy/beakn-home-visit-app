// =============================================================================
// HVA-34: Cloudflare Turnstile server-side verification
// =============================================================================
//
// Calls Cloudflare's siteverify endpoint to validate a token issued by the
// Turnstile widget on /request. The widget runs entirely in the user's
// browser; this server-side check is what actually gates the form against
// bots. Skipping or weakening this step makes the widget cosmetic.
//
// CONTRACT:
//   verifyTurnstile(token, remoteIp?): Promise<{ success, errorCodes? }>
//   Never throws. Network errors / timeouts / non-200 responses all
//   resolve to `{ success: false, errorCodes: [...] }` so callers can
//   handle one shape consistently.
//
// FAIL-CLOSED:
//   5-second timeout via AbortController. Cloudflare's median response
//   is <100ms; a slow Cloudflare = an outage we shouldn't try to wait
//   through. Returning success=false on timeout means a Cloudflare
//   outage blocks form submissions, which is the safer failure mode
//   for an anti-spam check.
//
// SECRET HANDLING:
//   process.env.TURNSTILE_SECRET_KEY is read fresh on every call (no
//   module-level capture). Server-only — `lib/turnstile.ts` must never
//   be imported from a 'use client' file. Verify via bundle grep
//   before completing each release.
// =============================================================================

import { log } from '@/lib/logger';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

const turnstileLogger = log.child({ component: 'turnstile' });

export interface TurnstileVerifyResult {
  success: boolean;
  errorCodes?: string[];
}

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    turnstileLogger.error(
      { configured: false },
      'turnstile_secret_missing',
    );
    return { success: false, errorCodes: ['missing-secret-server'] };
  }

  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: ctrl.signal,
      // No-cache: every call is a fresh single-use token verification.
      cache: 'no-store',
    });

    if (!res.ok) {
      turnstileLogger.warn(
        { status: res.status, remoteIp },
        'turnstile_siteverify_non_ok',
      );
      return { success: false, errorCodes: [`http-${res.status}`] };
    }

    const json = (await res.json()) as SiteverifyResponse;
    const errorCodes = json['error-codes'];

    if (!json.success) {
      turnstileLogger.warn(
        { errorCodes, remoteIp },
        'turnstile_siteverify_failed',
      );
      return { success: false, errorCodes: errorCodes ?? [] };
    }

    return { success: true, errorCodes };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    turnstileLogger.warn(
      {
        aborted,
        remoteIp,
        err: err instanceof Error ? err.message : String(err),
      },
      aborted ? 'turnstile_siteverify_timeout' : 'turnstile_siteverify_error',
    );
    return {
      success: false,
      errorCodes: [aborted ? 'timeout' : 'network-error'],
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
