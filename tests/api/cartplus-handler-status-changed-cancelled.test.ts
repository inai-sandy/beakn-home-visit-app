import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

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
  webhookSecrets,
} from '@/db/schema';
import { computeCartplusSignature } from '@/lib/webhooks/cartplus/verify';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-251 (HVA-230 Phase 2.B): order.status_changed + order.cancelled handler tests
// =============================================================================

const TEST_SECRET = 'cartplus_251_test_secret_aaaaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(async () => {
  // Re-seed the migration 0069 portal notification rules per test
  // (truncateAll wipes them).
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

afterAll(async () => {
  // No persistent cities added — defensive.
  void sql;
});

async function seedActiveSecret() {
  const admin = await seedSuperAdmin({ phone: '+919985950001' });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });
}

async function setupBaseOrder(opts: {
  storeId: number;
  portalExecId: number;
  portalOrderId: number;
  portalLineItemId: number;
}): Promise<{ requestId: string; quotationId: string }> {
  // First fire order.created so we have an existing quotation
  await seedActiveSecret();
  const captain = await seedCaptain({ phone: `+91998599${randomDigits()}` });
  const exec = await seedExecutive(captain.id, {
    phone: `+91998599${randomDigits()}`,
    fullName: 'Exec H251',
  });
  const bangalore = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    .set({ cartplusStoreId: opts.storeId })
    .where(eq(cities.id, bangalore.id));
  await db
    .update(users)
    .set({ portalExecId: opts.portalExecId })
    .where(eq(users.id, exec.id));

  const createEnvelope = {
    id: `evt_setup_${opts.portalOrderId}`,
    type: 'order.created',
    store: { id: opts.storeId, slug: 'test', name: 'Test' },
    data: {
      order: {
        id: opts.portalOrderId,
        order_number: `CP-${opts.portalOrderId}`,
        status: 'confirmed',
        payment_status: 'paid',
        fulfillment_status: 'pending',
        currency: 'INR',
        total_amount: 1000,
        placed_at: '2026-06-08T10:00:00Z',
        items: [
          {
            id: opts.portalLineItemId,
            product_id: 701,
            name: 'Initial Item',
            sku: 'INIT-001',
            unit_price: 500,
            quantity: 2,
            line_total: 1000,
            notes: null,
          },
        ],
        created_by: {
          id: opts.portalExecId,
          name: 'Exec H251',
          email: null,
        },
        customer: {
          id: 301,
          name: 'Test Customer',
          phone: `+9198765${randomDigits()}`,
          email: null,
        },
      },
    },
    created_at: '2026-06-08T10:30:00Z',
  };
  const body = JSON.stringify(createEnvelope);
  const sig = computeCartplusSignature(TEST_SECRET, body);
  await POST(
    new Request('https://visits.beakn.in/api/webhooks/cartplus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cartplus-signature': sig,
        'x-cartplus-event': 'order.created',
        'x-cartplus-delivery': `dlv_setup_${opts.portalOrderId}`,
      },
      body,
    }) as never,
  );
  const [quote] = await db
    .select()
    .from(quotations)
    .where(eq(quotations.portalQuotationId, String(opts.portalOrderId)));
  return { requestId: quote!.visitRequestId, quotationId: quote!.id };
}

let randomCounter = 0;
function randomDigits(): string {
  randomCounter += 1;
  return String(1000 + randomCounter).padStart(4, '0');
}

function fireWebhook(envelope: unknown, eventType: string): Promise<Response> {
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

describe('order.status_changed handler', () => {
  it('updates the existing quotation header + upserts existing line items', async () => {
    const { quotationId } = await setupBaseOrder({
      storeId: 9101,
      portalExecId: 4001,
      portalOrderId: 8001,
      portalLineItemId: 7001,
    });

    // status_changed with updated price + quantity
    const envelope = {
      id: 'evt_status_change_8001',
      type: 'order.status_changed',
      store: { id: 9101, slug: 'test', name: 'Test' },
      data: {
        order: {
          id: 8001,
          order_number: 'CP-8001',
          status: 'preparing',
          payment_status: 'paid',
          fulfillment_status: 'pending',
          currency: 'INR',
          total_amount: 1500, // changed
          placed_at: '2026-06-08T10:00:00Z',
          items: [
            {
              id: 7001,
              product_id: 701,
              name: 'Updated Item Name',
              sku: 'UPD-001',
              unit_price: 750, // changed
              quantity: 2,
              line_total: 1500, // changed
              notes: null,
            },
          ],
          created_by: { id: 4001, name: 'Exec H251', email: null },
          customer: {
            id: 301,
            name: 'Test Customer',
            phone: '+919876510001',
            email: null,
          },
        },
      },
      created_at: '2026-06-08T11:00:00Z',
    };
    const res = await fireWebhook(envelope, 'order.status_changed');
    expect(res.status).toBe(200);

    const [updatedQuote] = await db
      .select()
      .from(quotations)
      .where(eq(quotations.id, quotationId));
    expect(updatedQuote!.totalOrderValuePaise).toBe(150000); // 1500 × 100

    const items = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quotationId));
    expect(items.length).toBe(1); // updated in place, not duplicated
    expect(items[0]!.productName).toBe('Updated Item Name');
    expect(items[0]!.unitPricePaise).toBe(75000);
  });

  it('inserts NEW line items that did not exist before', async () => {
    const { quotationId } = await setupBaseOrder({
      storeId: 9102,
      portalExecId: 4002,
      portalOrderId: 8002,
      portalLineItemId: 7002,
    });

    const envelope = {
      id: 'evt_new_item_8002',
      type: 'order.status_changed',
      store: { id: 9102, slug: 'test', name: 'Test' },
      data: {
        order: {
          id: 8002,
          order_number: 'CP-8002',
          status: 'preparing',
          payment_status: 'paid',
          fulfillment_status: 'pending',
          currency: 'INR',
          total_amount: 2500,
          placed_at: '2026-06-08T10:00:00Z',
          items: [
            {
              id: 7002,
              product_id: 701,
              name: 'Initial Item',
              sku: 'INIT-001',
              unit_price: 500,
              quantity: 2,
              line_total: 1000,
              notes: null,
            },
            {
              id: 9999, // new line item ID
              product_id: 702,
              name: 'Newly Added Item',
              sku: 'NEW-001',
              unit_price: 750,
              quantity: 2,
              line_total: 1500,
              notes: null,
            },
          ],
          created_by: { id: 4002, name: 'Exec H251', email: null },
          customer: {
            id: 301,
            name: 'Test Customer',
            phone: '+919876520002',
            email: null,
          },
        },
      },
      created_at: '2026-06-08T11:00:00Z',
    };
    const res = await fireWebhook(envelope, 'order.status_changed');
    expect(res.status).toBe(200);

    const items = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quotationId));
    expect(items.length).toBe(2);
    const newItem = items.find((i) => i.portalLineItemId === 9999);
    expect(newItem).toBeDefined();
    expect(newItem!.productName).toBe('Newly Added Item');
  });

  it('skipped result when portal_quotation_id has no match (missed create)', async () => {
    await seedActiveSecret();
    const envelope = {
      id: 'evt_missing_quote_0001',
      type: 'order.status_changed',
      store: { id: 9999, slug: 'x', name: 'X' },
      data: {
        order: {
          id: 99999,
          order_number: 'CP-99999',
          status: 'confirmed',
          payment_status: 'paid',
          fulfillment_status: 'pending',
          currency: 'INR',
          total_amount: 100,
          placed_at: '2026-06-08T00:00:00Z',
          items: [
            {
              id: 1,
              product_id: 1,
              name: 'X',
              sku: null,
              unit_price: 100,
              quantity: 1,
              line_total: 100,
              notes: null,
            },
          ],
          created_by: { id: 1, name: 'X', email: null },
          customer: {
            id: 1,
            name: 'X',
            phone: '+919876510101',
            email: null,
          },
        },
      },
      created_at: '2026-06-08T00:00:00Z',
    };
    const res = await fireWebhook(envelope, 'order.status_changed');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: string };
    expect(json.result).toBe('skipped');
  });
});

describe('order.cancelled handler', () => {
  it('cancels the visit_request with portal cancellation reason', async () => {
    const { requestId } = await setupBaseOrder({
      storeId: 9201,
      portalExecId: 4101,
      portalOrderId: 8101,
      portalLineItemId: 7101,
    });

    const envelope = {
      id: 'evt_cancel_8101',
      type: 'order.cancelled',
      store: { id: 9201, slug: 'test', name: 'Test' },
      data: {
        order: {
          id: 8101,
          order_number: 'CP-8101',
          status: 'cancelled',
          payment_status: 'refunded',
          fulfillment_status: 'cancelled',
          currency: 'INR',
          total_amount: 1000,
          placed_at: '2026-06-08T10:00:00Z',
          items: [
            {
              id: 7101,
              product_id: 701,
              name: 'Initial Item',
              sku: 'INIT-001',
              unit_price: 500,
              quantity: 2,
              line_total: 1000,
              notes: null,
            },
          ],
          created_by: { id: 4101, name: 'Exec', email: null },
          customer: {
            id: 301,
            name: 'Test Customer',
            phone: '+919876510004',
            email: null,
          },
        },
      },
      created_at: '2026-06-08T12:00:00Z',
    };
    const res = await fireWebhook(envelope, 'order.cancelled');
    expect(res.status).toBe(200);

    const [request] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));
    expect(request!.cancelledAt).not.toBeNull();
    expect(request!.cancellationActor).toBe('customer');
    expect(request!.cancellationReason).toBe('Cancelled in CartPlus portal');
    expect(request!.cancellationReasonCode).toBe('portal_cancelled');
  });

  it('idempotent — second cancel webhook is a noop', async () => {
    const { requestId } = await setupBaseOrder({
      storeId: 9202,
      portalExecId: 4102,
      portalOrderId: 8102,
      portalLineItemId: 7102,
    });

    const envelope = {
      id: 'evt_cancel_idem_8102_first',
      type: 'order.cancelled',
      store: { id: 9202, slug: 'test', name: 'Test' },
      data: {
        order: {
          id: 8102,
          order_number: 'CP-8102',
          status: 'cancelled',
          payment_status: 'refunded',
          fulfillment_status: 'cancelled',
          currency: 'INR',
          total_amount: 1000,
          placed_at: '2026-06-08T10:00:00Z',
          items: [
            {
              id: 7102,
              product_id: 701,
              name: 'Initial',
              sku: null,
              unit_price: 500,
              quantity: 2,
              line_total: 1000,
              notes: null,
            },
          ],
          created_by: { id: 4102, name: 'Exec', email: null },
          customer: {
            id: 301,
            name: 'C',
            phone: '+919876510005',
            email: null,
          },
        },
      },
      created_at: '2026-06-08T12:00:00Z',
    };
    await fireWebhook(envelope, 'order.cancelled');

    const [first] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));
    const firstCancelledAt = first!.cancelledAt!;

    // Fire again with different event ID (so idempotency at the webhook
    // layer doesn't kick in — we want to exercise the handler's
    // already-cancelled branch).
    const envelope2 = { ...envelope, id: 'evt_cancel_idem_8102_second' };
    const res2 = await fireWebhook(envelope2, 'order.cancelled');
    expect(res2.status).toBe(200);

    const [second] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));
    // Cancellation timestamp should NOT have changed
    expect(second!.cancelledAt!.getTime()).toBe(firstCancelledAt.getTime());

    const [eventRow] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_cancel_idem_8102_second'));
    expect(eventRow!.result).toBe('ok');
  });

  it('skipped result when no matching quotation (missed create)', async () => {
    await seedActiveSecret();
    const envelope = {
      id: 'evt_cancel_missing_0001',
      type: 'order.cancelled',
      store: { id: 9999, slug: 'x', name: 'X' },
      data: {
        order: {
          id: 99998,
          order_number: 'CP-99998',
          status: 'cancelled',
          payment_status: 'refunded',
          fulfillment_status: 'cancelled',
          currency: 'INR',
          total_amount: 100,
          placed_at: '2026-06-08T00:00:00Z',
          items: [
            {
              id: 1,
              product_id: 1,
              name: 'X',
              sku: null,
              unit_price: 100,
              quantity: 1,
              line_total: 100,
              notes: null,
            },
          ],
          created_by: { id: 1, name: 'X', email: null },
          customer: {
            id: 1,
            name: 'X',
            phone: '+919876510106',
            email: null,
          },
        },
      },
      created_at: '2026-06-08T00:00:00Z',
    };
    const res = await fireWebhook(envelope, 'order.cancelled');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: string };
    expect(json.result).toBe('skipped');
  });
});
