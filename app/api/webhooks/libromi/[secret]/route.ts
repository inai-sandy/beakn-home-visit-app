import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import { whatsappDispatches } from '@/db/schema';
import { log } from '@/lib/logger';

// =============================================================================
// Libromi WhatsApp webhook receiver
// =============================================================================
//
// POST /api/webhooks/libromi/[secret]
//
// Libromi posts status events here as they arrive from Meta. Payload is
// Meta WhatsApp Cloud API format (entry → changes → value → statuses)
// PLUS Libromi adds a top-level `message_id_map` that links
// `wamid.HBg…` (Meta's message id) to the Libromi messageId we already
// stored in whatsapp_dispatches.external_id when the send returned 201.
//
// SECURITY
//
// Libromi does not sign webhooks (no HMAC, no bearer). Defence is:
//
//   (1) Long random URL secret — every request whose `[secret]` path
//       segment doesn't match LIBROMI_WEBHOOK_SECRET is 404'd. Spoofers
//       without the secret can't even reach our parser.
//
//   (2) MessageId allowlist — even with the URL secret, we only update
//       rows whose external_id is already in whatsapp_dispatches.
//       Spoofed events for unknown messageIds get logged + dropped (200,
//       no DB write — Libromi never retries because we returned 200,
//       and the row that does exist isn't tampered).
//
// IDEMPOTENCY
//
// Each lifecycle column (provider_sent_at / delivered_at / read_at /
// failed_at) is set only if currently NULL. Webhook retries from Libromi
// (e.g. when our endpoint timed out on a previous attempt) become
// no-ops. We do NOT track an event-uniqueness id; the per-column NULL
// gate is enough.
//
// FAST RESPONSE
//
// We return 200 as quickly as possible (target: <500ms). Libromi retries
// non-200 responses, so a slow handler causes duplicate events. All
// per-event work happens inline (small UPDATEs) but failures fall
// through to a 200 so retries don't compound.
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeLog = log.child({ component: 'webhooks.libromi' });

interface StatusEvent {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

interface LibromiWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        messaging_product?: string;
        metadata?: Record<string, unknown>;
        contacts?: Array<{ wa_id?: string; user_id?: string }>;
        statuses?: StatusEvent[];
        messages?: unknown;
      };
      field?: string;
    }>;
  }>;
  message_id_map?: Record<string, string>;
}

interface RouteParams {
  params: Promise<{ secret: string }>;
}

export async function POST(req: Request, ctx: RouteParams) {
  const expected = process.env.LIBROMI_WEBHOOK_SECRET;
  if (!expected || expected.length < 16) {
    // Refuse if the operator forgot to set the secret post-deploy — same
    // pattern as the cron routes.
    routeLog.error({}, 'LIBROMI_WEBHOOK_SECRET_unset_refusing_request');
    return new NextResponse('Not found', { status: 404 });
  }

  const { secret } = await ctx.params;
  if (secret !== expected) {
    // Return 404 not 401 — don't reveal that the path pattern exists.
    return new NextResponse('Not found', { status: 404 });
  }

  let body: LibromiWebhookBody;
  try {
    body = (await req.json()) as LibromiWebhookBody;
  } catch (err) {
    routeLog.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'invalid_json_payload',
    );
    // Return 200 anyway — Libromi shouldn't retry malformed payloads.
    return NextResponse.json({ ok: true, skipped: 'invalid_json' });
  }

  const messageIdMap = body.message_id_map ?? {};

  let processed = 0;
  let unknown = 0;
  let updated = 0;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const statuses = change.value?.statuses ?? [];
      for (const ev of statuses) {
        processed += 1;
        const wamid = ev.id;
        const externalId = wamid ? messageIdMap[wamid] : undefined;

        if (!externalId) {
          // Spoof / payload-without-map / out-of-band — log + drop.
          unknown += 1;
          routeLog.warn(
            { wamid, status: ev.status, hasMap: Object.keys(messageIdMap).length > 0 },
            'webhook_event_missing_external_id',
          );
          continue;
        }

        const eventTimestamp = ev.timestamp
          ? new Date(parseInt(ev.timestamp, 10) * 1000)
          : new Date();

        try {
          const didUpdate = await applyStatus({
            externalId,
            wamid: wamid ?? null,
            status: ev.status ?? 'unknown',
            eventTimestamp,
            errors: ev.errors,
          });
          if (didUpdate) updated += 1;
        } catch (err) {
          routeLog.error(
            {
              externalId,
              status: ev.status,
              err: err instanceof Error ? err.message : String(err),
            },
            'webhook_event_update_failed',
          );
          // Keep going — one bad event shouldn't poison the whole batch.
        }
      }
    }
  }

  routeLog.info(
    { processed, updated, unknown },
    'webhook_batch_processed',
  );

  return NextResponse.json({ ok: true, processed, updated, unknown });
}

// -----------------------------------------------------------------------------
// applyStatus — set the lifecycle column matching the event's `status`,
// only if currently NULL. Always stamps wamid on first observation.
// Returns true when a row was actually updated.
// -----------------------------------------------------------------------------

interface ApplyStatusArgs {
  externalId: string;
  wamid: string | null;
  status: string;
  eventTimestamp: Date;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

async function applyStatus(args: ApplyStatusArgs): Promise<boolean> {
  // Look up the dispatch row first — defends against spoofed externalIds.
  const [row] = await db
    .select({
      id: whatsappDispatches.id,
      wamid: whatsappDispatches.wamid,
      providerSentAt: whatsappDispatches.providerSentAt,
      deliveredAt: whatsappDispatches.deliveredAt,
      readAt: whatsappDispatches.readAt,
      failedAt: whatsappDispatches.failedAt,
    })
    .from(whatsappDispatches)
    .where(eq(whatsappDispatches.externalId, args.externalId))
    .limit(1);

  if (!row) {
    routeLog.warn(
      { externalId: args.externalId, status: args.status },
      'webhook_event_unknown_external_id',
    );
    return false;
  }

  // Build the partial update. Always stamp wamid on first observation;
  // always stamp the matching column only if currently NULL.
  const patch: Partial<typeof whatsappDispatches.$inferInsert> = {};
  if (!row.wamid && args.wamid) {
    patch.wamid = args.wamid;
  }

  switch (args.status) {
    case 'sent':
      if (!row.providerSentAt) patch.providerSentAt = args.eventTimestamp;
      break;
    case 'delivered':
      if (!row.deliveredAt) patch.deliveredAt = args.eventTimestamp;
      break;
    case 'read':
      if (!row.readAt) patch.readAt = args.eventTimestamp;
      break;
    case 'failed':
      if (!row.failedAt) patch.failedAt = args.eventTimestamp;
      if (args.errors && args.errors[0]) {
        const e = args.errors[0];
        if (typeof e.code === 'number') patch.failureCode = e.code;
        // Concatenate title + message for readability ("Message
        // undeliverable: Message Undeliverable.") — keeps the row
        // browsable from SQL without a JSON parse.
        const reasonParts = [e.title, e.message].filter(
          (s): s is string => typeof s === 'string' && s.length > 0,
        );
        if (reasonParts.length > 0) {
          patch.failureReason = Array.from(new Set(reasonParts)).join(': ');
        }
      }
      break;
    default:
      // Unknown status (Meta could add new ones — error / deleted / etc).
      // Stamp wamid if needed but otherwise no-op the columns.
      routeLog.warn(
        { externalId: args.externalId, status: args.status },
        'webhook_unknown_status',
      );
      break;
  }

  if (Object.keys(patch).length === 0) {
    // Idempotent path — all relevant columns already populated.
    return false;
  }

  await db
    .update(whatsappDispatches)
    .set(patch)
    .where(eq(whatsappDispatches.externalId, args.externalId));

  return true;
}
