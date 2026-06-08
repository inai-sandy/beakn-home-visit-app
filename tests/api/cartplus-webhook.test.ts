import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import { webhookEvents, webhookSecrets } from '@/db/schema';
import {
  computeCartplusSignature,
  verifyCartplusSignature,
} from '@/lib/webhooks/cartplus/verify';

import { seedSuperAdmin } from '../helpers/db';

// =============================================================================
// HVA-249 (HVA-230): CartPlus webhook receiver tests
// =============================================================================

const TEST_SECRET = 'cartplus_test_secret_64char_hex_aaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function seedActiveSecret(): Promise<string> {
  const admin = await seedSuperAdmin({ phone: '+919985700001' });
  const [row] = await db
    .insert(webhookSecrets)
    .values({
      provider: 'cartplus',
      secret: TEST_SECRET,
      secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
      createdByUserId: admin.id,
    })
    .returning({ id: webhookSecrets.id });
  return row.id;
}

// Use order.status_changed for receiver-level tests — HVA-250 only wired
// the order.created handler, so status_changed flows through the simple
// "stored, no handler" path that these tests are exercising.
function buildEnvelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'evt_test_0001',
    type: 'order.status_changed',
    store: { id: 101, slug: 'test-store', name: 'Test Store' },
    data: { order: { id: 501 } },
    created_at: '2026-06-08T10:00:00Z',
    ...overrides,
  };
}

function buildRequest(body: string, signature: string | null): Request {
  return new Request('https://visits.beakn.in/api/webhooks/cartplus', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-cartplus-signature': signature } : {}),
      'x-cartplus-event': 'order.status_changed',
      'x-cartplus-delivery': 'dlv_test_0001',
    },
    body,
  });
}

describe('verifyCartplusSignature', () => {
  it('accepts a correct signature', () => {
    const body = '{"a":1}';
    const sig = computeCartplusSignature(TEST_SECRET, body);
    expect(verifyCartplusSignature(TEST_SECRET, body, sig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = computeCartplusSignature(TEST_SECRET, '{"a":1}');
    expect(verifyCartplusSignature(TEST_SECRET, '{"a":2}', sig)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const body = '{"a":1}';
    expect(verifyCartplusSignature(TEST_SECRET, body, null)).toBe(false);
    expect(verifyCartplusSignature(TEST_SECRET, body, '')).toBe(false);
  });

  it('rejects a wrong-length signature without throwing', () => {
    const body = '{"a":1}';
    expect(verifyCartplusSignature(TEST_SECRET, body, 'short')).toBe(false);
  });
});

describe('POST /api/webhooks/cartplus', () => {
  beforeEach(async () => {
    // Clear secrets between tests so each test seeds its own active row.
    await db.delete(webhookSecrets);
    await db.delete(webhookEvents);
  });

  it('returns 503 when no active secret exists', async () => {
    const body = JSON.stringify(buildEnvelope());
    const res = await POST(buildRequest(body, 'whatever') as never);
    expect(res.status).toBe(503);
  });

  it('rejects with 401 when signature missing', async () => {
    await seedActiveSecret();
    const body = JSON.stringify(buildEnvelope());
    const res = await POST(buildRequest(body, null) as never);
    expect(res.status).toBe(401);
    const rows = await db.select().from(webhookEvents);
    expect(rows.length).toBe(0);
  });

  it('rejects with 401 on tampered body', async () => {
    await seedActiveSecret();
    const body = JSON.stringify(buildEnvelope());
    const sig = computeCartplusSignature(TEST_SECRET, body);
    // Tamper after signing
    const tampered = body.replace('"id":501', '"id":999');
    const res = await POST(buildRequest(tampered, sig) as never);
    expect(res.status).toBe(401);
    const rows = await db.select().from(webhookEvents);
    expect(rows.length).toBe(0);
  });

  it('accepts a valid signature and writes a webhook_events row', async () => {
    await seedActiveSecret();
    const body = JSON.stringify(buildEnvelope({ id: 'evt_happy_0001' }));
    const sig = computeCartplusSignature(TEST_SECRET, body);
    const res = await POST(buildRequest(body, sig) as never);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_happy_0001'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.provider).toBe('cartplus');
    expect(rows[0]!.eventType).toBe('order.status_changed');
    expect(rows[0]!.deliveryId).toBe('dlv_test_0001');
    expect(rows[0]!.result).toBe('noop');
  });

  it('idempotency: duplicate event id returns 200 noop with no second row', async () => {
    await seedActiveSecret();
    const body = JSON.stringify(buildEnvelope({ id: 'evt_idem_0001' }));
    const sig = computeCartplusSignature(TEST_SECRET, body);
    const first = await POST(buildRequest(body, sig) as never);
    expect(first.status).toBe(200);

    const second = await POST(buildRequest(body, sig) as never);
    expect(second.status).toBe(200);
    const json = (await second.json()) as { reason?: string };
    expect(json.reason).toBe('duplicate');

    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_idem_0001'));
    expect(rows.length).toBe(1);
  });

  it('parse failure writes a dead-letter row with result=error', async () => {
    await seedActiveSecret();
    const body = JSON.stringify({ totally: 'wrong shape' });
    const sig = computeCartplusSignature(TEST_SECRET, body);
    const res = await POST(buildRequest(body, sig) as never);
    expect(res.status).toBe(400);

    const rows = await db.select().from(webhookEvents);
    expect(rows.length).toBe(1);
    expect(rows[0]!.result).toBe('error');
    expect(rows[0]!.errorMessage).toBeTruthy();
    expect(rows[0]!.providerEventId).toMatch(/^unparseable:/);
  });

  it('bad JSON returns 400 (no dead-letter row, since pre-envelope parse)', async () => {
    await seedActiveSecret();
    const body = 'not-json{';
    const sig = computeCartplusSignature(TEST_SECRET, body);
    const res = await POST(buildRequest(body, sig) as never);
    expect(res.status).toBe(400);
    const rows = await db.select().from(webhookEvents);
    expect(rows.length).toBe(0);
  });

  it('updates webhook_secrets.last_used_at on successful verification', async () => {
    const secretId = await seedActiveSecret();
    const body = JSON.stringify(buildEnvelope({ id: 'evt_touch_0001' }));
    const sig = computeCartplusSignature(TEST_SECRET, body);
    await POST(buildRequest(body, sig) as never);
    // Best-effort fire-and-forget — wait a beat for the async update.
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await db
      .select()
      .from(webhookSecrets)
      .where(eq(webhookSecrets.id, secretId));
    expect(row!.lastUsedAt).not.toBeNull();
  });
});
