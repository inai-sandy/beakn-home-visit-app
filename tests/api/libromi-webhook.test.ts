import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { whatsappDispatches } from '@/db/schema';

import { POST } from '@/app/api/webhooks/libromi/[secret]/route';

// =============================================================================
// Libromi WhatsApp webhook receiver tests
// =============================================================================
//
// Covers the three core promises of the receiver:
//   1. URL secret defence — wrong / missing secret → 404 (and no DB
//      write).
//   2. MessageId allowlist defence — events for external_ids not in
//      whatsapp_dispatches get logged + dropped (200, no DB write).
//   3. Per-column idempotency — repeat events on the same status are
//      no-ops; column values latch on the first observation.
//
// Also exercises the four real status paths (sent / delivered / read /
// failed-with-errors) end-to-end so a change to the parser is caught.
// =============================================================================

const PRIOR_SECRET = process.env.LIBROMI_WEBHOOK_SECRET;
const TEST_SECRET = 'test-secret-2026-06-02-libromi-webhook-abcd1234';

beforeAll(() => {
  process.env.LIBROMI_WEBHOOK_SECRET = TEST_SECRET;
});

afterAll(() => {
  if (PRIOR_SECRET !== undefined) {
    process.env.LIBROMI_WEBHOOK_SECRET = PRIOR_SECRET;
  } else {
    delete process.env.LIBROMI_WEBHOOK_SECRET;
  }
});

beforeEach(async () => {
  // Clear test dispatches before each test so external_id collisions don't
  // surface from previously-seeded rows.
  await db
    .delete(whatsappDispatches)
    .where(eq(whatsappDispatches.externalId, 'LIBROMI-TEST-001'));
});

function buildReq(body: unknown): Request {
  return new Request(
    `https://visits.beakn.in/api/webhooks/libromi/${TEST_SECRET}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function buildCtx(secret: string) {
  return { params: Promise.resolve({ secret }) };
}

function statusPayload(opts: {
  externalId: string;
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: number;
  errorCode?: number;
  errorTitle?: string;
  errorMessage?: string;
}) {
  const ev: Record<string, unknown> = {
    id: opts.wamid,
    status: opts.status,
    timestamp: String(opts.timestamp ?? 1780422887),
    recipient_id: '919885698665',
  };
  if (opts.status === 'failed') {
    ev.errors = [
      {
        code: opts.errorCode ?? 131026,
        title: opts.errorTitle ?? 'Message undeliverable',
        message: opts.errorMessage ?? 'Message undeliverable',
      },
    ];
  }
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '3675234602631980',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              statuses: [ev],
            },
            field: 'messages',
          },
        ],
      },
    ],
    message_id_map: { [opts.wamid]: opts.externalId },
  };
}

async function seedDispatch(externalId: string) {
  await db.insert(whatsappDispatches).values({
    externalId,
    recipientPhone: '+919885698665',
    templateName: 'tracking_link_confirmation',
    eventType: 'request.created',
    recipientRole: 'customer',
  });
}

describe('POST /api/webhooks/libromi/[secret]', () => {
  it('rejects with 404 when the URL secret is wrong', async () => {
    const res = await POST(
      buildReq(
        statusPayload({
          externalId: 'LIBROMI-TEST-001',
          wamid: 'wamid.test1',
          status: 'sent',
        }),
      ),
      buildCtx('wrong-secret'),
    );
    expect(res.status).toBe(404);
  });

  it('rejects with 404 when LIBROMI_WEBHOOK_SECRET is unset', async () => {
    delete process.env.LIBROMI_WEBHOOK_SECRET;
    try {
      const res = await POST(
        buildReq(
          statusPayload({
            externalId: 'LIBROMI-TEST-001',
            wamid: 'wamid.test1',
            status: 'sent',
          }),
        ),
        buildCtx(TEST_SECRET),
      );
      expect(res.status).toBe(404);
    } finally {
      process.env.LIBROMI_WEBHOOK_SECRET = TEST_SECRET;
    }
  });

  it('returns 200 + drops the event when external_id is not in the allowlist', async () => {
    const res = await POST(
      buildReq(
        statusPayload({
          externalId: 'LIBROMI-TEST-001', // Not seeded
          wamid: 'wamid.spoof',
          status: 'delivered',
        }),
      ),
      buildCtx(TEST_SECRET),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      processed: number;
      updated: number;
    };
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.updated).toBe(0);
  });

  it('stamps provider_sent_at when a sent event arrives', async () => {
    await seedDispatch('LIBROMI-TEST-001');
    const res = await POST(
      buildReq(
        statusPayload({
          externalId: 'LIBROMI-TEST-001',
          wamid: 'wamid.test1',
          status: 'sent',
          timestamp: 1780422887,
        }),
      ),
      buildCtx(TEST_SECRET),
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(whatsappDispatches)
      .where(eq(whatsappDispatches.externalId, 'LIBROMI-TEST-001'))
      .limit(1);
    expect(row.providerSentAt).not.toBeNull();
    expect(row.wamid).toBe('wamid.test1');
    expect(row.deliveredAt).toBeNull();
    expect(row.readAt).toBeNull();
    expect(row.failedAt).toBeNull();
  });

  it('stamps delivered_at + read_at across the happy path (3 events)', async () => {
    await seedDispatch('LIBROMI-TEST-001');
    for (const status of ['sent', 'delivered', 'read'] as const) {
      const res = await POST(
        buildReq(
          statusPayload({
            externalId: 'LIBROMI-TEST-001',
            wamid: 'wamid.test1',
            status,
            timestamp: 1780422887,
          }),
        ),
        buildCtx(TEST_SECRET),
      );
      expect(res.status).toBe(200);
    }
    const [row] = await db
      .select()
      .from(whatsappDispatches)
      .where(eq(whatsappDispatches.externalId, 'LIBROMI-TEST-001'))
      .limit(1);
    expect(row.providerSentAt).not.toBeNull();
    expect(row.deliveredAt).not.toBeNull();
    expect(row.readAt).not.toBeNull();
    expect(row.failedAt).toBeNull();
  });

  it('captures failure_code + failure_reason on a failed event', async () => {
    await seedDispatch('LIBROMI-TEST-001');
    const res = await POST(
      buildReq(
        statusPayload({
          externalId: 'LIBROMI-TEST-001',
          wamid: 'wamid.test1',
          status: 'failed',
          errorCode: 131026,
          errorTitle: 'Message undeliverable',
          errorMessage: 'Message undeliverable',
        }),
      ),
      buildCtx(TEST_SECRET),
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(whatsappDispatches)
      .where(eq(whatsappDispatches.externalId, 'LIBROMI-TEST-001'))
      .limit(1);
    expect(row.failedAt).not.toBeNull();
    expect(row.failureCode).toBe(131026);
    // Title + message duped at the source; the dedupe + join should
    // produce "Message undeliverable" once.
    expect(row.failureReason).toBe('Message undeliverable');
  });

  it('is idempotent — repeat delivered events do not overwrite the original timestamp', async () => {
    await seedDispatch('LIBROMI-TEST-001');
    // First delivered event with an early timestamp.
    await POST(
      buildReq(
        statusPayload({
          externalId: 'LIBROMI-TEST-001',
          wamid: 'wamid.test1',
          status: 'delivered',
          timestamp: 1780000000,
        }),
      ),
      buildCtx(TEST_SECRET),
    );
    const [first] = await db
      .select()
      .from(whatsappDispatches)
      .where(eq(whatsappDispatches.externalId, 'LIBROMI-TEST-001'))
      .limit(1);
    const originalDelivered = first.deliveredAt;
    expect(originalDelivered).not.toBeNull();

    // Replay the same event much later.
    const res = await POST(
      buildReq(
        statusPayload({
          externalId: 'LIBROMI-TEST-001',
          wamid: 'wamid.test1',
          status: 'delivered',
          timestamp: 1899999999,
        }),
      ),
      buildCtx(TEST_SECRET),
    );
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(0);

    const [second] = await db
      .select()
      .from(whatsappDispatches)
      .where(eq(whatsappDispatches.externalId, 'LIBROMI-TEST-001'))
      .limit(1);
    expect(second.deliveredAt?.toISOString()).toBe(
      originalDelivered?.toISOString(),
    );
  });

  it('returns 200 for malformed JSON', async () => {
    const req = new Request(
      `https://visits.beakn.in/api/webhooks/libromi/${TEST_SECRET}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      },
    );
    const res = await POST(req, buildCtx(TEST_SECRET));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped?: string };
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe('invalid_json');
  });
});
