import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import {
  cities,
  notificationRules,
  quotationLineItems,
  quotations,
  users,
  visitRequests,
  webhookEvents,
} from '@/db/schema';
import { computeCartplusSignature } from '@/lib/webhooks/cartplus/verify';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';
import { webhookSecrets } from '@/db/schema';

// =============================================================================
// HVA-280: CartPlus webhook hardening — regression tests
// =============================================================================
//
// H1 — line items removed in CartPlus are soft-removed (and excluded from
//      "current" reads), and a re-add clears the flag.
// H2 — an event whose first delivery FAILED (result='error') is
//      REPROCESSED on the CartPlus retry; an already-'ok' event is not.
// =============================================================================

const TEST_SECRET = 'cartplus_280_test_secret_bbbbbbbbbbbbbbbbbbbbbbbbbb';

let counter = 0;
function uniq(): string {
  counter += 1;
  return String(1000 + counter).padStart(4, '0');
}

beforeEach(async () => {
  await db
    .insert(notificationRules)
    .values([
      {
        eventType: 'webhook.cartplus.order_received',
        channel: 'in_app',
        recipientRole: 'exec_assigned',
        enabled: true,
        templateKey: null,
      },
    ])
    .onConflictDoNothing();
});

async function seedActiveSecret(): Promise<void> {
  const admin = await seedSuperAdmin({ phone: `+9199859${uniq()}` });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });
}

interface OrderItem {
  id: number;
  product_id: number | null;
  name: string;
  sku: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  notes: string | null;
}

function orderEnvelope(opts: {
  eventId: string;
  type: string;
  storeId: number;
  portalExecId: number;
  portalOrderId: number;
  totalAmount: number;
  items: OrderItem[];
  phone: string;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    type: opts.type,
    store: { id: opts.storeId, slug: 'test', name: 'Test' },
    data: {
      order: {
        id: opts.portalOrderId,
        order_number: `CP-${opts.portalOrderId}`,
        status: 'confirmed',
        payment_status: 'paid',
        fulfillment_status: 'pending',
        currency: 'INR',
        total_amount: opts.totalAmount,
        placed_at: '2026-06-08T10:00:00Z',
        items: opts.items,
        created_by: { id: opts.portalExecId, name: 'Exec H280', email: null },
        customer: { id: 301, name: 'HW Customer', phone: opts.phone, email: null },
      },
    },
    created_at: '2026-06-08T10:30:00Z',
  };
}

function fire(envelope: Record<string, unknown>, eventType: string): Promise<Response> {
  const body = JSON.stringify(envelope);
  const sig = computeCartplusSignature(TEST_SECRET, body);
  return POST(
    new Request('https://visits.beakn.in/api/webhooks/cartplus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cartplus-signature': sig,
        'x-cartplus-event': eventType,
        'x-cartplus-delivery': `dlv_${Math.random()}`,
      },
      body,
    }) as never,
  );
}

async function seedMappedCityAndExec(storeId: number, portalExecId: number): Promise<void> {
  await seedActiveSecret();
  const captain = await seedCaptain({ phone: `+9199858${uniq()}` });
  const exec = await seedExecutive(captain.id, {
    phone: `+9199858${uniq()}`,
    fullName: 'Exec H280',
  });
  const city = await getOrCreateCity('Bangalore');
  await db.update(cities).set({ cartplusStoreId: storeId }).where(eq(cities.id, city.id));
  await db.update(users).set({ portalExecId }).where(eq(users.id, exec.id));
}

describe('H1: line-item removal sync', () => {
  it('soft-removes an item dropped from the order and excludes it from current reads; re-add restores it', async () => {
    const phone = `+9198761${uniq()}`;
    await seedMappedCityAndExec(9201, 5201);

    // created: two items
    await fire(
      orderEnvelope({
        eventId: 'evt_h1_create',
        type: 'order.created',
        storeId: 9201,
        portalExecId: 5201,
        portalOrderId: 8201,
        totalAmount: 1500,
        phone,
        items: [
          { id: 7201, product_id: 1, name: 'Curtain', sku: 'C1', unit_price: 1000, quantity: 1, line_total: 1000, notes: null },
          { id: 7202, product_id: 2, name: 'Blind', sku: 'B1', unit_price: 500, quantity: 1, line_total: 500, notes: null },
        ],
      }),
      'order.created',
    );
    const [quote] = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(eq(quotations.portalQuotationId, '8201'));
    const quotationId = quote!.id;

    // status_changed: customer removed the Blind (item 7202)
    await fire(
      orderEnvelope({
        eventId: 'evt_h1_remove',
        type: 'order.status_changed',
        storeId: 9201,
        portalExecId: 5201,
        portalOrderId: 8201,
        totalAmount: 1000,
        phone,
        items: [
          { id: 7201, product_id: 1, name: 'Curtain', sku: 'C1', unit_price: 1000, quantity: 1, line_total: 1000, notes: null },
        ],
      }),
      'order.status_changed',
    );

    // The removed row still exists (no hard delete) but is marked removed.
    const all = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quotationId));
    const blind = all.find((r) => r.portalLineItemId === 7202);
    expect(blind).toBeDefined();
    expect(blind!.removedAt).not.toBeNull();
    const curtain = all.find((r) => r.portalLineItemId === 7201);
    expect(curtain!.removedAt).toBeNull();

    // Current (non-removed) items = just the Curtain.
    const current = all.filter((r) => r.removedAt === null);
    expect(current.length).toBe(1);
    expect(current[0]!.portalLineItemId).toBe(7201);

    // Re-add the Blind → removed flag cleared.
    await fire(
      orderEnvelope({
        eventId: 'evt_h1_readd',
        type: 'order.status_changed',
        storeId: 9201,
        portalExecId: 5201,
        portalOrderId: 8201,
        totalAmount: 1500,
        phone,
        items: [
          { id: 7201, product_id: 1, name: 'Curtain', sku: 'C1', unit_price: 1000, quantity: 1, line_total: 1000, notes: null },
          { id: 7202, product_id: 2, name: 'Blind', sku: 'B1', unit_price: 500, quantity: 1, line_total: 500, notes: null },
        ],
      }),
      'order.status_changed',
    );
    const afterReadd = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quotationId));
    expect(afterReadd.find((r) => r.portalLineItemId === 7202)!.removedAt).toBeNull();
    expect(afterReadd.filter((r) => r.removedAt === null).length).toBe(2);
  });
});

describe('H2: failed events reprocess on retry', () => {
  it("reprocesses a previously-failed event id (result='error') instead of dedup-skipping it", async () => {
    const phone = `+9198762${uniq()}`;
    await seedMappedCityAndExec(9202, 5202);

    const eventId = 'evt_h2_failed_then_retry';
    // Simulate a first delivery that FAILED: a dead-letter row already
    // exists for this event id with result='error' and no request created.
    await db.insert(webhookEvents).values({
      provider: 'cartplus',
      providerEventId: eventId,
      eventType: 'order.created',
      deliveryId: 'dlv_first_failed',
      payload: { simulated: 'first-attempt-error' },
      result: 'error',
      errorMessage: 'simulated transient failure',
    });

    // CartPlus retries with the SAME event id. The receiver must
    // reprocess (not return noop) and the order must materialise.
    const res = await fire(
      orderEnvelope({
        eventId,
        type: 'order.created',
        storeId: 9202,
        portalExecId: 5202,
        portalOrderId: 8202,
        totalAmount: 999,
        phone,
        items: [
          { id: 7203, product_id: 3, name: 'Roller', sku: 'R1', unit_price: 999, quantity: 1, line_total: 999, notes: null },
        ],
      }),
      'order.created',
    );
    expect(res.status).toBe(200);

    const [quote] = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(eq(quotations.portalQuotationId, '8202'));
    expect(quote).toBeDefined(); // reprocess actually created the order

    const [row] = await db
      .select({ result: webhookEvents.result })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, 'cartplus'),
          eq(webhookEvents.providerEventId, eventId),
        ),
      );
    expect(row!.result).toBe('ok'); // healed
  });

  it("does NOT reprocess an event id already marked 'ok'", async () => {
    await seedMappedCityAndExec(9203, 5203);
    const eventId = 'evt_h2_already_ok';
    await db.insert(webhookEvents).values({
      provider: 'cartplus',
      providerEventId: eventId,
      eventType: 'order.created',
      deliveryId: 'dlv_ok',
      payload: { simulated: 'already-done' },
      result: 'ok',
      processedAt: new Date(),
    });

    const res = await fire(
      orderEnvelope({
        eventId,
        type: 'order.created',
        storeId: 9203,
        portalExecId: 5203,
        portalOrderId: 8203,
        totalAmount: 500,
        phone: `+9198763${uniq()}`,
        items: [
          { id: 7204, product_id: 4, name: 'Drape', sku: 'D1', unit_price: 500, quantity: 1, line_total: 500, notes: null },
        ],
      }),
      'order.created',
    );
    const json = (await res.json()) as { result?: string; reason?: string };
    expect(res.status).toBe(200);
    expect(json.result).toBe('noop');

    // No order created — the 'ok' event short-circuited.
    const made = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(eq(quotations.portalQuotationId, '8203'));
    expect(made.length).toBe(0);
  });
});

void visitRequests;
