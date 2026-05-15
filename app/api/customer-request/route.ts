import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import {
  cities,
  rateLimitAttempts,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';
import { verifyTurnstile } from '@/lib/turnstile';
import {
  customerRequestSchema,
  type CustomerRequestInput,
} from '@/lib/validators/customer-request';

// =============================================================================
// HVA-34 + HVA-33: customer request submission pipeline
// =============================================================================
//
// Order of operations (each gate runs only if the previous succeeded):
//   1. JSON parse
//   2. Zod re-validation (HVA-34)
//   3. Rate-limit check + insert (HVA-34)
//   4. Turnstile verification (HVA-34)
//   5. Phone-duplicate soft-block (HVA-33; 1-hour rolling window)
//   6. nanoid 21-char tracking token, looped on collision
//   7. Resolve city_id (name → uuid) and status_stage_id ('SUBMITTED')
//   8. INSERT into visit_requests
//   9. Audit log (eventType: 'request_created', actor NULL)
//  10. Notification engine TODO (HVA-48/49 — pino log only for now)
//  11. Return 200 { ok: true, trackingToken }
//
// HVA-33 schema-vs-form reconciliation (resolved before write):
//   - Form field `bhk` arrives with a space ('2 BHK'); DB enum is space-
//     less ('2BHK'). Stripped at insert. 'Others' stays as 'Others'.
//   - Form field `state` has no schema column. Added customer_state
//     varchar(100) nullable in 0004_hva33_seed_phase1_cities_status_
//     stages.sql; written through verbatim.
//   - Form field `accuracy` has no schema column. Added
//     location_accuracy numeric(10,2) in the same migration.
//   - Form field `city` arrives as an enum NAME ('Hyderabad'); DB
//     column is city_id (FK to cities.id). Lookup by name → id at
//     insert time. 'Other' is a real seeded row in cities.
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
const DEDUP_WINDOW = '1 hour';
const TRACKING_TOKEN_LENGTH = 21;
const MAX_TOKEN_COLLISION_RETRIES = 5;
const STATUS_STAGE_SUBMITTED = 'SUBMITTED';
const apiLog = log.child({ route: '/api/customer-request' });

// Form-side BHK values include a space ('2 BHK'); DB enum is spaceless
// ('2BHK'). 'Others' stays unchanged. Mapping is deterministic — no
// need for an object lookup.
function toDbBhk(formBhk: CustomerRequestInput['bhk']): string {
  return formBhk.replace(/\s+/g, '');
}

async function generateUniqueTrackingToken(): Promise<string> {
  for (let i = 0; i < MAX_TOKEN_COLLISION_RETRIES; i++) {
    const token = nanoid(TRACKING_TOKEN_LENGTH);
    const existing = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, token))
      .limit(1);
    if (existing.length === 0) return token;
  }
  // 21-char URL-safe nanoid has ~149 bits of entropy. Five consecutive
  // collisions would require an astronomical number of rows. If we
  // somehow get here, surface as a 500 — the alternative is a stuck
  // loop or a token reuse.
  throw new Error('nanoid token collision retries exhausted');
}

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

  // 5. Phone-duplicate soft block. The phone is "+91"+10digits at this
  //    point (formed below by `"+91" + parsed.data.phone`). We dedupe
  //    on the SAME storage shape that will be written, so the lookup
  //    matches whatever the previous insert wrote.
  //
  //    Policy: 1-hour rolling window. Matches the spec line "duplicate
  //    phone within 1 hour → soft block". Dedup applies regardless of
  //    the existing row's status (Cancelled, etc.) — the spec is silent
  //    on terminal-state behaviour, and a cancelled-then-resubmit
  //    customer should re-fill the form anyway, not re-receive the
  //    cancelled token. Revisit when HVA-39 (cancellation backend) lands.
  const customerPhoneStorage = `+91${parsed.data.phone}`;
  const dupRows = await db
    .select({
      trackingToken: visitRequests.trackingToken,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.customerPhone, customerPhoneStorage),
        gte(
          visitRequests.createdAt,
          sql`now() - interval ${sql.raw(`'${DEDUP_WINDOW}'`)}`,
        ),
      ),
    )
    .orderBy(desc(visitRequests.createdAt))
    .limit(1);

  if (dupRows.length > 0) {
    const existing = dupRows[0];
    reqLog.info(
      {
        existingTrackingToken: existing.trackingToken,
        existingCreatedAt: existing.createdAt,
      },
      'customer_request_duplicate_phone_soft_block',
    );
    return NextResponse.json(
      {
        ok: true,
        duplicate: true,
        existingTrackingToken: existing.trackingToken,
        message:
          'We already received your request. Check your WhatsApp for the tracking link.',
      },
      { status: 200 },
    );
  }

  // 6. Resolve FKs: city by name, status_stage by code. Both seeded by
  //    the 0004_hva33 migration. Missing seed rows are an infra bug,
  //    not a customer-facing problem — surface as 500.
  const [cityRow] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, parsed.data.city))
    .limit(1);
  if (!cityRow) {
    reqLog.error(
      { city: parsed.data.city },
      'customer_request_city_not_seeded',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  const [submittedStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, STATUS_STAGE_SUBMITTED))
    .limit(1);
  if (!submittedStage) {
    reqLog.error(
      {},
      'customer_request_submitted_stage_not_seeded',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 7. Generate token + INSERT.
  let trackingToken: string;
  try {
    trackingToken = await generateUniqueTrackingToken();
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'customer_request_tracking_token_generation_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  let insertedId: string;
  try {
    const [row] = await db
      .insert(visitRequests)
      .values({
        customerName: parsed.data.name,
        customerPhone: customerPhoneStorage,
        customerEmail: parsed.data.email,
        address: parsed.data.address,
        cityId: cityRow.id,
        customerState: parsed.data.state,
        // bhk_type enum is spaceless; form gives '2 BHK'.
        bhk: toDbBhk(parsed.data.bhk) as
          | '1BHK'
          | '2BHK'
          | '3BHK'
          | '4BHK'
          | 'Others',
        interest: parsed.data.interest,
        // Drizzle's numeric() expects string; tagged template handles
        // both number and string inputs, but explicit String() keeps
        // the call site obvious.
        latitude:
          parsed.data.latitude !== undefined
            ? String(parsed.data.latitude)
            : null,
        longitude:
          parsed.data.longitude !== undefined
            ? String(parsed.data.longitude)
            : null,
        locationAccuracy:
          parsed.data.accuracy !== undefined
            ? String(parsed.data.accuracy)
            : null,
        trackingToken,
        statusStageId: submittedStage.id,
        // `source` defaults to 'web' at the column level.
      })
      .returning({ id: visitRequests.id });
    insertedId = row.id;
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'customer_request_insert_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 8. Audit log. Customer is anonymous — actor_user_id NULL. action
  //    name 'request_created' is flat snake_case per the HVA-28
  //    precedent (codebase convention; Linear body's casual
  //    'request.created' dot-form is descriptive only).
  await logEvent({
    eventType: 'request_created',
    actorUserId: null,
    actorRole: null,
    targetEntityType: 'visit_request',
    targetEntityId: insertedId,
    afterState: {
      trackingToken,
      city: parsed.data.city,
      bhk: parsed.data.bhk,
      interestCount: parsed.data.interest.length,
      hasCoords: parsed.data.latitude !== undefined,
    },
    reason: 'customer_form_submission',
    ipAddress: ip,
    userAgent: reqHeaders.get('user-agent'),
  });

  // 9. Notification engine — STUB. HVA-48 (multi-channel dispatch) and
  //    HVA-49 (WhatsApp/email transport) will replace this with the
  //    real call.
  // TODO(HVA-48/HVA-49): dispatchNotification('request.submitted', {
  //   requestId: insertedId,
  //   customerName: parsed.data.name,
  //   customerPhone: customerPhoneStorage,
  //   customerEmail: parsed.data.email,
  //   trackingToken,
  // })
  reqLog.info(
    {
      requestId: insertedId,
      trackingToken,
      notificationEngine: 'pending_HVA-48',
    },
    'customer_request_notification_pending',
  );

  return NextResponse.json(
    { ok: true, trackingToken },
    { status: 200 },
  );
}
