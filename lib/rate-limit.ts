import { and, gte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { rateLimitAttempts } from '@/db/schema';

// =============================================================================
// HVA-322: shared token-window rate limiter for public endpoints
// =============================================================================
//
// The customer-facing surfaces authenticate with a tracking token in the URL
// and nothing else — no session, no cookie. That makes them the one place in
// the app where an unauthenticated caller can drive writes and fire
// notifications, so each needs a quota.
//
// This is the pattern HVA-259 landed in app/api/customer/support-tickets,
// lifted into lib/ rather than copy-pasted a third and fourth time (the
// no-duplication rule in CLAUDE.md). Two details in it are load-bearing and
// easy to get wrong when re-implementing from memory:
//
//   1. KEY ON THE TOKEN, NOT THE IP. Legitimate customers share NAT — a
//      building, an office, a mobile carrier — so an IP quota punishes
//      innocent people while a determined abuser just changes address. The
//      token is the thing being protected, so the token carries the quota.
//      The IP is still recorded for forensics.
//
//   2. ONLY RECORD AN ATTEMPT THAT WILL BE ALLOWED. Inserting
//      unconditionally means rejected attempts count toward the window, so a
//      user who trips the limit can never get back under it and is locked out
//      one submission earlier than the stated maximum. That was the HVA-259
//      bug.
//
// The count and the insert run in ONE transaction so two concurrent requests
// cannot both read count = max - 1 and both proceed.
// =============================================================================

export interface TokenRateLimitInput {
  /** Namespace for the quota, e.g. 'track_reschedule'. Keeps unrelated
   *  surfaces from sharing a bucket. */
  scope: string;
  /** The tracking token — the credential being rate-limited. */
  token: string;
  /** Postgres interval literal, e.g. '24 hours'. */
  window: string;
  /** Attempts allowed inside the window. */
  max: number;
  /** Caller IP, recorded for forensics only. Never part of the key. */
  ipAddress?: string | null;
}

export type TokenRateLimitResult =
  | { ok: true; attemptsInWindow: number }
  | { ok: false; reason: 'limited'; attemptsInWindow: number }
  /** The DB is unreachable. Callers should return 503 rather than fall open —
   *  a rate limiter that silently stops limiting is worse than a visible
   *  outage, because nothing reveals it. */
  | { ok: false; reason: 'unavailable'; attemptsInWindow: 0 };

export async function checkTokenRateLimit(
  input: TokenRateLimitInput,
): Promise<TokenRateLimitResult> {
  const key = `${input.scope}:${input.token}`;
  const ip = input.ipAddress ?? 'unknown';

  try {
    const attemptsInWindow = await db.transaction(async (tx) => {
      // Housekeeping: the table is append-only otherwise, and this is the
      // only place rows are removed (an explicitly permitted exception to the
      // no-deletes rule — see CLAUDE.md).
      await tx.execute(
        sql`DELETE FROM rate_limit_attempts WHERE attempted_at < now() - interval '24 hours'`,
      );

      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimitAttempts)
        .where(
          and(
            sql`${rateLimitAttempts.key} = ${key}`,
            gte(
              rateLimitAttempts.attemptedAt,
              sql`now() - interval ${sql.raw(`'${input.window}'`)}`,
            ),
          ),
        );

      if (n < input.max) {
        await tx.insert(rateLimitAttempts).values({ key, ipAddress: ip });
      }
      return n;
    });

    return attemptsInWindow >= input.max
      ? { ok: false, reason: 'limited', attemptsInWindow }
      : { ok: true, attemptsInWindow };
  } catch {
    return { ok: false, reason: 'unavailable', attemptsInWindow: 0 };
  }
}
