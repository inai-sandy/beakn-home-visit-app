import { NextResponse, type NextRequest } from 'next/server';

import { getActiveCartplusSecret } from '@/lib/admin/cartplus';
import { log } from '@/lib/logger';
import { cartplusEnvelopeSchema } from '@/lib/webhooks/cartplus/envelope';
import { handleCartplusOrderCreated } from '@/lib/webhooks/cartplus/handler-order-created';
import {
  recordCartplusEvent,
  touchSecretLastUsed,
} from '@/lib/webhooks/cartplus/record';
import { verifyCartplusSignature } from '@/lib/webhooks/cartplus/verify';

// =============================================================================
// HVA-249 (HVA-230): POST /api/webhooks/cartplus
// =============================================================================
//
// CartPlus webhook receiver. Authenticated by HMAC-SHA256 over the raw
// request body (X-CartPlus-Signature). Persists to webhook_events for
// idempotency + audit. The handler that creates HVA visit_requests lives
// in HVA-250; this PR only verifies + logs.
//
// Response contract:
//   200 ok         — verified, stored (or duplicate); CartPlus moves on
//   200 noop       — duplicate event id (idempotency hit)
//   400 bad        — envelope parse failure (dead-letter row written)
//   401 invalid    — signature mismatch (no row; CartPlus may retry)
//   503 unavail    — no active secret configured
//
// We deliberately return 200 on parse failure too: CartPlus retries on
// non-2xx, and retries of a malformed payload won't fix anything — better
// to admit the bad envelope into the dead-letter table for engineering
// to inspect.
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeLog = log.child({ component: 'webhooks.cartplus' });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deliveryId = req.headers.get('x-cartplus-delivery') ?? null;
  const eventHeader = req.headers.get('x-cartplus-event') ?? null;
  const signature = req.headers.get('x-cartplus-signature') ?? null;

  // Raw body — CartPlus signs the bytes as-is, so we MUST hash before any
  // JSON parsing reorders keys / loses whitespace.
  const rawBody = await req.text();

  routeLog.info(
    {
      deliveryId,
      eventHeader,
      bodyLength: rawBody.length,
      hasSignature: Boolean(signature),
    },
    'webhook_received',
  );

  // ---------- Lookup active signing secret ----------
  const active = await getActiveCartplusSecret();
  if (!active) {
    routeLog.warn({ deliveryId }, 'webhook_no_active_secret');
    return NextResponse.json(
      { ok: false, error: 'No active CartPlus signing secret configured' },
      { status: 503 },
    );
  }

  // ---------- Verify HMAC ----------
  if (!verifyCartplusSignature(active.secret, rawBody, signature)) {
    routeLog.warn(
      { deliveryId, eventHeader, sigLen: signature?.length ?? 0 },
      'webhook_signature_invalid',
    );
    return NextResponse.json(
      { ok: false, error: 'Invalid signature' },
      { status: 401 },
    );
  }

  // Best-effort touch — non-blocking.
  void touchSecretLastUsed(active.id);

  // ---------- Parse envelope ----------
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (err) {
    routeLog.warn(
      { deliveryId, eventHeader, err: String(err) },
      'webhook_invalid_json',
    );
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const envelopeResult = cartplusEnvelopeSchema.safeParse(parsedJson);
  if (!envelopeResult.success) {
    const issues = envelopeResult.error.issues
      .map((i) => `${i.path.join('.')}:${i.message}`)
      .join('; ');
    routeLog.warn(
      { deliveryId, eventHeader, issues },
      'webhook_parse_failed',
    );
    // Write a dead-letter row so engineering can inspect the bad payload.
    await recordCartplusEvent({
      // Without an envelope id we synthesize one to satisfy NOT NULL while
      // preserving the delivery ID for correlation.
      providerEventId: `unparseable:${deliveryId ?? Date.now()}`,
      eventType: eventHeader ?? 'unknown',
      deliveryId,
      payload: { raw: rawBody.slice(0, 2000), issues },
      initialResult: 'error',
      errorMessage: issues.slice(0, 1000),
    }).catch(() => {
      /* dead-letter persistence is best-effort */
    });
    return NextResponse.json(
      { ok: false, error: 'Bad envelope shape', issues },
      { status: 400 },
    );
  }

  const envelope = envelopeResult.data;

  // ---------- Persist (idempotency via UNIQUE) ----------
  const outcome = await recordCartplusEvent({
    providerEventId: envelope.id,
    eventType: envelope.type,
    deliveryId,
    payload: envelope as unknown as Record<string, unknown>,
    initialResult: 'noop', // bumped to 'ok' by the handler when matched
  });

  if (outcome.status === 'duplicate') {
    routeLog.info(
      { deliveryId, eventId: envelope.id, eventType: envelope.type },
      'webhook_idempotency_hit',
    );
    return NextResponse.json(
      { ok: true, result: 'noop', reason: 'duplicate' },
      { status: 200 },
    );
  }

  routeLog.info(
    {
      deliveryId,
      eventId: envelope.id,
      eventType: envelope.type,
      storeId: envelope.store.id,
      webhookEventId: outcome.webhookEventId,
    },
    'webhook_stored',
  );

  // ---------- Dispatch to per-event handler (HVA-250+) ----------
  if (envelope.type === 'order.created' && outcome.webhookEventId) {
    const handlerOutcome = await handleCartplusOrderCreated(
      envelope,
      outcome.webhookEventId,
    );
    return NextResponse.json(
      {
        ok: handlerOutcome.status !== 'error',
        result: handlerOutcome.status,
        requestId: handlerOutcome.requestId ?? null,
        webhookEventId: outcome.webhookEventId,
        ...(handlerOutcome.reason ? { reason: handlerOutcome.reason } : {}),
      },
      { status: handlerOutcome.status === 'error' ? 500 : 200 },
    );
  }

  // Other event types (status_changed, cancelled) wire up in HVA-251.
  return NextResponse.json(
    { ok: true, result: 'noop', webhookEventId: outcome.webhookEventId },
    { status: 200 },
  );
}
