import { and, gte, sql } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import { rateLimitAttempts } from '@/db/schema';
import { log } from '@/lib/logger';
import { verifyTurnstile } from '@/lib/turnstile';
import { customerRequestSchema } from '@/lib/validators/customer-request';

// =============================================================================
// HVA-34: customer request submission — anti-spam shell + stub
// =============================================================================
//
// SHELL ONLY. HVA-34 owns:
//   1. Zod re-validation (defence-in-depth; client also validates)
//   2. Cloudflare Turnstile token verification
//   3. Postgres-backed rate limit (5 Zod-passing attempts per IP / 1h)
// HVA-33 replaces the trailing stub with the real DB write +
// token generation + redirect-target response.
//
// RATE-LIMIT POLICY (locked, see commit body for full reasoning):
// Count every attempt that PASSES Zod, regardless of Turnstile outcome.
// Tradeoff: bots without valid Turnstile tokens still increment the
// counter for their IP, which could theoretically lock out a legitimate
// user on the same NAT'd IP. We accept that risk because:
//   - Turnstile is defence in depth, not the sole gate; rate-limiting
//     should bite *before* a Turnstile bypass attack lands.
//   - The 5/hour ceiling is liberal — a single user submits 1, maybe 2
//     to correct a mistake. Hitting 5 means something automated is in
//     the loop, regardless of who started it.
//   - Counter rolls off automatically on a 1-hour window.
//
// =============================================================================

const RATE_LIMIT_WINDOW = '1 hour';
const RATE_LIMIT_MAX = 5;
const KEY_PREFIX = 'request_submit';
const apiLog = log.child({ route: '/api/customer-request' });

function extractIp(headers: Headers): string {
  // Caddy forwards via x-forwarded-for. First IP in the comma-separated
  // chain is the original client; subsequent entries are proxy hops.
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

export async function POST(req: Request): Promise<NextResponse> {
  const reqHeaders = await headersFn();
  const requestId = reqHeaders.get('x-request-id') ?? undefined;
  const ip = extractIp(reqHeaders);
  const reqLog = apiLog.child({ requestId, ip });

  // 1. Parse JSON body. Defensive against malformed payloads.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  // 2. Server-side Zod re-validation. Never trust the client to have
  //    enforced anything.
  const parsed = customerRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    reqLog.info(
      { fieldErrors },
      'customer_request_zod_rejected',
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'Some fields are invalid. Check the form and try again.',
        fieldErrors,
      },
      { status: 400 },
    );
  }

  // 3. Rate limit FIRST (before Turnstile). Policy: count every attempt
  //    that passes Zod, regardless of Turnstile outcome. If we let
  //    Turnstile-failed attempts skip the counter, an attacker can hammer
  //    the endpoint with bad tokens indefinitely — costs Cloudflare CPU,
  //    no defence at our layer. Counting before Turnstile ensures the
  //    rate limit bites even when Turnstile is being brute-forced. The
  //    tradeoff (bots can lock out shared NAT users for an hour) is
  //    accepted because the 5/hour ceiling is liberal enough that
  //    legitimate users almost never hit it.
  const key = `${KEY_PREFIX}:${ip}`;
  let attemptsInWindow = 0;
  try {
    attemptsInWindow = await db.transaction(async (tx) => {
      // Cleanup rows older than 24h. Cheap (indexed) and idempotent;
      // running it here amortises maintenance across all calls.
      await tx.execute(
        sql`DELETE FROM rate_limit_attempts WHERE attempted_at < now() - interval '24 hours'`,
      );

      // Count attempts in the last hour for this key. Cast to int so
      // drizzle hands back a JS number rather than a string from
      // PG's bigint.
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimitAttempts)
        .where(
          and(
            sql`${rateLimitAttempts.key} = ${key}`,
            gte(
              rateLimitAttempts.attemptedAt,
              sql`now() - interval ${sql.raw(`'${RATE_LIMIT_WINDOW}'`)}`,
            ),
          ),
        );

      // Record THIS attempt. (If the rate limit fires below, the row
      // still exists — that's the policy: every Zod-passing attempt
      // counts, including the one that triggered the limit.)
      await tx.insert(rateLimitAttempts).values({
        key,
        ipAddress: ip,
      });

      return n;
    });
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'customer_request_rate_limit_db_error',
    );
    // Fail-closed: if the rate-limit table is unreachable we can't safely
    // accept the submission. Better to surface a transient error than
    // open the gate.
    return NextResponse.json(
      {
        ok: false,
        error: 'Service temporarily unavailable. Please try again shortly.',
      },
      { status: 503 },
    );
  }

  if (attemptsInWindow >= RATE_LIMIT_MAX) {
    reqLog.warn(
      { attemptsInWindow },
      'customer_request_rate_limited',
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'Too many requests, try again in an hour.',
      },
      { status: 429 },
    );
  }

  // 4. Turnstile verification. Server-side gate — the widget's own
  //    callback is just there to enable submit on the client. Runs
  //    AFTER the rate-limit insert so a sustained bad-token stream
  //    still hits the rate-limit ceiling.
  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstile.success) {
    reqLog.warn(
      { errorCodes: turnstile.errorCodes ?? [] },
      'customer_request_turnstile_failed',
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'Verification failed. Please retry the challenge.',
      },
      { status: 400 },
    );
  }

  // 5. STUB. HVA-33 replaces this block with token generation + DB
  //    insert + redirect-target response. For now: log the validated
  //    payload (minus the Turnstile token — single-use, no value in
  //    keeping it) and return success.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { turnstileToken: _t, ...payload } = parsed.data;
  reqLog.info(
    { attemptsInWindow, hasCoords: payload.latitude !== undefined },
    'customer_request_stub_passed_anti_spam',
  );

  return NextResponse.json(
    { ok: true, stub: true, message: 'HVA-34 anti-spam checks passed' },
    { status: 200 },
  );
}
