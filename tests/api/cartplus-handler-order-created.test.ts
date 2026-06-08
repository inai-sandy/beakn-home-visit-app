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
// HVA-250 (HVA-230 Phase 2.A): order.created handler integration tests
// =============================================================================

const TEST_SECRET = 'cartplus_handler_test_secret_aaaaaaaaaaaaaaaaaaaaaaa';
const TEST_CITY_NAMES_TO_CLEANUP: string[] = [];

afterAll(async () => {
  // truncateAll preserves the cities seed but we created none — still
  // protect against future additions to this file.
  if (TEST_CITY_NAMES_TO_CLEANUP.length > 0) {
    await db
      .delete(cities)
      .where(sql`name = ANY(ARRAY[${sql.join(TEST_CITY_NAMES_TO_CLEANUP, sql`, `)}]::text[])`);
  }
});

async function reseedPortalNotificationRules() {
  // truncateAll wipes notification_rules. Re-seed the migration 0069
  // rules that handler-order-created fires through dispatchNotification.
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
      {
        eventType: 'webhook.cartplus.order_received',
        channel: 'in_app',
        recipientRole: 'captain_owning_city',
        enabled: true,
        templateKey: null,
      },
      {
        eventType: 'webhook.cartplus.order_received',
        channel: 'in_app',
        recipientRole: 'super_admin',
        enabled: true,
        templateKey: null,
      },
    ])
    .onConflictDoNothing();
}

async function seedActiveSecretAndAdmin(): Promise<string> {
  const admin = await seedSuperAdmin({ phone: '+919985900001' });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });
  return admin.id;
}

function buildOrderCreatedEnvelope(opts: {
  eventId?: string;
  orderId?: number;
  storeId?: number;
  customerPhone?: string;
  customerName?: string;
  createdById?: number | null;
  totalAmount?: number;
  productName?: string;
  itemId?: number;
  productId?: number | null;
}): {
  body: string;
  signature: string;
} {
  const envelope = {
    id: opts.eventId ?? 'evt_order_created_0001',
    type: 'order.created',
    store: {
      id: opts.storeId ?? 101,
      slug: 'test-store',
      name: 'Test Store',
    },
    data: {
      order: {
        id: opts.orderId ?? 501,
        order_number: 'CP-1001',
        status: 'confirmed',
        payment_status: 'paid',
        fulfillment_status: 'pending',
        currency: 'INR',
        total_amount: opts.totalAmount ?? 1250.5,
        placed_at: '2026-06-08T10:00:00Z',
        items: [
          {
            id: opts.itemId ?? 9001,
            product_id: opts.productId ?? 701,
            name: opts.productName ?? 'Premium Curtains 8x4',
            sku: 'CRT-001',
            unit_price: 250,
            quantity: 2,
            line_total: 500,
            notes: null,
          },
        ],
        created_by:
          opts.createdById === undefined
            ? { id: 42, name: 'Priya Sales', email: 'priya@beakn.in' }
            : opts.createdById === null
              ? null
              : { id: opts.createdById, name: 'Test Exec', email: null },
        customer: {
          id: 301,
          name: opts.customerName ?? 'Asha Kumar',
          phone: opts.customerPhone ?? '+919876543210',
          email: 'asha@example.com',
        },
      },
    },
    created_at: '2026-06-08T10:30:00Z',
  };
  const body = JSON.stringify(envelope);
  return { body, signature: computeCartplusSignature(TEST_SECRET, body) };
}

function buildRequest(body: string, signature: string): Request {
  return new Request('https://visits.beakn.in/api/webhooks/cartplus', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cartplus-signature': signature,
      'x-cartplus-event': 'order.created',
      'x-cartplus-delivery': 'dlv_handler_0001',
    },
    body,
  });
}

describe('order.created handler', () => {
  beforeEach(async () => {
    await reseedPortalNotificationRules();
  });

  it('creates a visit_request + quotation + line items when exec + city map cleanly', async () => {
    await seedActiveSecretAndAdmin();
    const captain = await seedCaptain({ phone: '+919985900002' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919985900003',
      fullName: 'Priya Sales',
    });
    const bangalore = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ cartplusStoreId: 8101 })
      .where(eq(cities.id, bangalore.id));
    await db
      .update(users)
      .set({ portalExecId: 42 })
      .where(eq(users.id, exec.id));

    const { body, signature } = buildOrderCreatedEnvelope({
      storeId: 8101,
      createdById: 42,
      eventId: 'evt_happy_0001',
      orderId: 7001,
      itemId: 8001,
    });
    const res = await POST(buildRequest(body, signature) as never);
    expect(res.status).toBe(200);

    // visit_request row exists, assigned to our exec, at QUOTATION_GIVEN
    const requests = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.cityId, bangalore.id));
    const portalReq = requests.find((r) => r.source === 'portal');
    expect(portalReq).toBeDefined();
    expect(portalReq!.assignedExecUserId).toBe(exec.id);
    expect(portalReq!.customerName).toBe('Asha Kumar');

    // quotation row tied to it, source=portal, portal_quotation_id=7001
    const [quotation] = await db
      .select()
      .from(quotations)
      .where(eq(quotations.visitRequestId, portalReq!.id));
    expect(quotation!.source).toBe('portal');
    expect(quotation!.portalQuotationId).toBe('7001');
    expect(quotation!.storeId).toBe(8101);

    // line item rows with portal IDs
    const items = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quotation!.id));
    expect(items.length).toBe(1);
    expect(items[0]!.portalLineItemId).toBe(8001);
    expect(items[0]!.portalProductId).toBe(701);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.unitPricePaise).toBe(25000); // 250 INR × 100

    // webhook_events.result flipped to 'ok'
    const [eventRow] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_happy_0001'));
    expect(eventRow!.result).toBe('ok');
  });

  it('falls back to "Other" city when store_id is unmapped', async () => {
    await seedActiveSecretAndAdmin();
    const captain = await seedCaptain({ phone: '+919985910001' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919985910002',
      fullName: 'Exec FallbackCity',
    });
    await db
      .update(users)
      .set({ portalExecId: 99 })
      .where(eq(users.id, exec.id));

    const { body, signature } = buildOrderCreatedEnvelope({
      storeId: 999999, // unmapped
      createdById: 99,
      eventId: 'evt_unmapped_city_0001',
      orderId: 7002,
    });
    const res = await POST(buildRequest(body, signature) as never);
    expect(res.status).toBe(200);

    const [otherCity] = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.name, 'Other'));
    const [portalReq] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.cityId, otherCity!.id));
    expect(portalReq!.source).toBe('portal');
    expect(portalReq!.assignedExecUserId).toBe(exec.id);
  });

  it('falls back to unassigned (null exec) when created_by is unmapped', async () => {
    await seedActiveSecretAndAdmin();
    const bangalore = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ cartplusStoreId: 8201 })
      .where(eq(cities.id, bangalore.id));

    const { body, signature } = buildOrderCreatedEnvelope({
      storeId: 8201,
      createdById: 999999, // unmapped
      eventId: 'evt_unmapped_exec_0001',
      orderId: 7003,
    });
    const res = await POST(buildRequest(body, signature) as never);
    expect(res.status).toBe(200);

    const [portalReq] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.cityId, bangalore.id));
    expect(portalReq!.source).toBe('portal');
    expect(portalReq!.assignedExecUserId).toBeNull();
  });

  it('storefront orders (created_by=null) go to unassigned bucket', async () => {
    await seedActiveSecretAndAdmin();
    const bangalore = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ cartplusStoreId: 8301 })
      .where(eq(cities.id, bangalore.id));

    const { body, signature } = buildOrderCreatedEnvelope({
      storeId: 8301,
      createdById: null,
      eventId: 'evt_storefront_0001',
      orderId: 7004,
    });
    const res = await POST(buildRequest(body, signature) as never);
    expect(res.status).toBe(200);

    const [portalReq] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.cityId, bangalore.id));
    expect(portalReq!.assignedExecUserId).toBeNull();
    expect(portalReq!.source).toBe('portal');
  });

  it('rejects bad payload shape with result=error and 500 response', async () => {
    await seedActiveSecretAndAdmin();
    // Valid envelope but data.order missing items array
    const bogus = {
      id: 'evt_bad_payload_0001',
      type: 'order.created',
      store: { id: 101, slug: 'x', name: 'X' },
      data: { order: { id: 1 } },
      created_at: '2026-06-08T00:00:00Z',
    };
    const body = JSON.stringify(bogus);
    const signature = computeCartplusSignature(TEST_SECRET, body);
    const res = await POST(buildRequest(body, signature) as never);
    expect(res.status).toBe(500);
    const [eventRow] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.providerEventId, 'evt_bad_payload_0001'));
    expect(eventRow!.result).toBe('error');
  });
});
