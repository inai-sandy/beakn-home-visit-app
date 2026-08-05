import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import {
  cities,
  inAppNotifications,
  notificationRules,
  quotations,
  requestOrderChanges,
  users,
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
// HVA-325: a CartPlus edit after Order Confirmed is recorded and announced
// =============================================================================
//
// Clicking Order Confirmed in the portal locks nothing in CartPlus — Beakn
// makes zero outbound calls — so the order stays editable and every edit
// rewrites our quotation regardless of how far the request has travelled.
//
// Five production orders changed value mid-flight with nobody told and
// nothing recorded. `CP-20260709-PNV2NR` went ₹4,174 → ₹8,354, was confirmed
// a minute later, and cancelled a minute after that; the only trace on screen
// was a "last synced" timestamp.
//
// The two conditions that gate this are what the tests below pin: it must be
// a MATERIAL change, on a request at or past ORDER_CONFIRMED.
// =============================================================================

const TEST_SECRET = 'cartplus_325_test_secret_cccccccccccccccccccccccccc';
const STORE_ID = 32501;

let seq = 0;
function nextDigits(): string {
  seq += 1;
  return String(5000 + seq).padStart(4, '0');
}

// users.portal_exec_id is UNIQUE — one id per seeded order.
function portalExecIdFor(portalOrderId: number): number {
  return portalOrderId + 700_000;
}

beforeEach(async () => {
  // truncateAll wipes notification_rules; re-seed what migration 0089 adds.
  await db
    .insert(notificationRules)
    .values(
      (
        [
          'exec_assigned',
          'captain_owning_city',
          'support_team_all',
          'super_admin',
        ] as const
      ).map((recipientRole) => ({
        eventType: 'webhook.cartplus.order_changed',
        channel: 'in_app' as const,
        recipientRole,
        enabled: true,
        templateKey: null,
      })),
    )
    .onConflictDoNothing();
});

async function fireWebhook(
  envelope: unknown,
  eventType: string,
): Promise<Response> {
  const body = JSON.stringify(envelope);
  const sig = computeCartplusSignature(TEST_SECRET, body);
  return POST(
    new Request('https://visits.beakn.in/api/webhooks/cartplus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cartplus-signature': sig,
        'x-cartplus-event': eventType,
        'x-cartplus-delivery': `dlv_325_${nextDigits()}`,
      },
      body,
    }) as never,
  );
}

interface ItemSpec {
  id: number;
  name?: string;
  sku?: string | null;
  unitPrice: number;
  quantity: number;
}

function orderPayload(
  portalOrderId: number,
  status: string,
  totalAmount: number,
  items: ItemSpec[],
  customerPhone: string,
) {
  return {
    id: portalOrderId,
    order_number: `CP-325-${portalOrderId}`,
    status,
    payment_status: 'paid',
    fulfillment_status: 'pending',
    currency: 'INR',
    total_amount: totalAmount,
    placed_at: '2026-08-05T10:00:00Z',
    items: items.map((i) => ({
      id: i.id,
      product_id: 901,
      name: i.name ?? `Item ${i.id}`,
      sku: i.sku === undefined ? `SKU-${i.id}` : i.sku,
      unit_price: i.unitPrice,
      quantity: i.quantity,
      line_total: i.unitPrice * i.quantity,
      notes: null,
    })),
    created_by: {
      id: portalExecIdFor(portalOrderId),
      name: 'Exec H325',
      email: null,
    },
    customer: {
      id: 601,
      name: 'Change Test Customer',
      phone: customerPhone,
      email: null,
    },
  };
}

interface Fixture {
  requestId: string;
  portalOrderId: number;
  customerPhone: string;
  execId: string;
  captainId: string;
  supportId: string;
  adminId: string;
}

async function setupOrder(
  portalOrderId: number,
  createStatus: 'confirmed' | 'pending',
): Promise<Fixture> {
  const admin = await seedSuperAdmin({ phone: `+91997325${nextDigits()}` });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });

  const captain = await seedCaptain({ phone: `+91997325${nextDigits()}` });
  const exec = await seedExecutive(captain.id, {
    phone: `+91997325${nextDigits()}`,
    fullName: 'Exec H325',
  });
  const [support] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support H325',
      phone: `+91997325${nextDigits()}`,
      phoneVerified: true,
      isActive: true,
    })
    .returning({ id: users.id });

  const city = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    .set({ cartplusStoreId: STORE_ID, captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  await db
    .update(users)
    .set({ portalExecId: portalExecIdFor(portalOrderId) })
    .where(eq(users.id, exec.id));

  const customerPhone = `+9198222${nextDigits()}`;
  await fireWebhook(
    {
      id: `evt_325_create_${portalOrderId}`,
      type: 'order.created',
      store: { id: STORE_ID, slug: 'test', name: 'Test' },
      data: {
        order: orderPayload(
          portalOrderId,
          createStatus,
          4174,
          [{ id: portalOrderId * 10, unitPrice: 4174, quantity: 1 }],
          customerPhone,
        ),
      },
      created_at: '2026-08-05T10:00:00Z',
    },
    'order.created',
  );

  const [quote] = await db
    .select({ requestId: quotations.visitRequestId })
    .from(quotations)
    .where(eq(quotations.portalQuotationId, String(portalOrderId)));

  await db
    .delete(inAppNotifications)
    .where(eq(inAppNotifications.eventType, 'webhook.cartplus.order_received'));

  return {
    requestId: quote!.requestId,
    portalOrderId,
    customerPhone,
    execId: exec.id,
    captainId: captain.id,
    supportId: support!.id,
    adminId: admin.id,
  };
}

async function changeRows(requestId: string) {
  return db
    .select()
    .from(requestOrderChanges)
    .where(eq(requestOrderChanges.visitRequestId, requestId));
}

async function changeNotifications(requestId: string) {
  return db
    .select({ userId: inAppNotifications.userId, body: inAppNotifications.body })
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.eventType, 'webhook.cartplus.order_changed'),
        eq(inAppNotifications.linkUrl, `/requests/${requestId}`),
      ),
    );
}

describe('CartPlus order edited after Order Confirmed', () => {
  it('records the change and tells exec, captain, support and admin', async () => {
    const fx = await setupOrder(930001, 'confirmed');

    // Ankit's edit: ₹4,174 → ₹8,354, one item becomes two.
    await fireWebhook(
      {
        id: `evt_325_upd_${fx.portalOrderId}`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(
            fx.portalOrderId,
            'confirmed',
            8354,
            [
              { id: fx.portalOrderId * 10, unitPrice: 4174, quantity: 1 },
              { id: fx.portalOrderId * 10 + 1, unitPrice: 4180, quantity: 1 },
            ],
            fx.customerPhone,
          ),
        },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.updated',
    );

    const rows = await changeRows(fx.requestId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.previousTotalPaise)).toBe(417_400);
    expect(Number(rows[0]!.newTotalPaise)).toBe(835_400);
    expect(rows[0]!.previousItemCount).toBe(1);
    expect(rows[0]!.newItemCount).toBe(2);
    expect(rows[0]!.itemsAdded).toBe(1);
    expect(rows[0]!.stageCode).toBe('ORDER_CONFIRMED');

    const notified = await changeNotifications(fx.requestId);
    expect(notified.map((n) => n.userId).sort()).toEqual(
      [fx.execId, fx.captainId, fx.supportId, fx.adminId].sort(),
    );
    // The number is the point of the message.
    for (const row of notified) {
      expect(row.body).toContain('₹4,174 → ₹8,354');
    }
  });

  it('the paired second webhook records nothing and notifies nobody', async () => {
    const fx = await setupOrder(930002, 'confirmed');

    const edited = {
      store: { id: STORE_ID, slug: 'test', name: 'Test' },
      data: {
        order: orderPayload(
          fx.portalOrderId,
          'confirmed',
          8354,
          [
            { id: fx.portalOrderId * 10, unitPrice: 4174, quantity: 1 },
            { id: fx.portalOrderId * 10 + 1, unitPrice: 4180, quantity: 1 },
          ],
          fx.customerPhone,
        ),
      },
      created_at: '2026-08-05T11:00:00Z',
    };

    // Exactly what production sends: order.updated then order.status_changed
    // ~200ms apart, both carrying the full order.
    await fireWebhook(
      { id: `evt_325_a_${fx.portalOrderId}`, type: 'order.updated', ...edited },
      'order.updated',
    );
    await fireWebhook(
      {
        id: `evt_325_b_${fx.portalOrderId}`,
        type: 'order.status_changed',
        ...edited,
      },
      'order.status_changed',
    );

    // One edit, one record, one round of notifications.
    expect(await changeRows(fx.requestId)).toHaveLength(1);
    expect(await changeNotifications(fx.requestId)).toHaveLength(4);
  });

  it('stays silent for an edit BEFORE Order Confirmed', async () => {
    // Below Order Confirmed an edit is ordinary quoting work, and
    // webhook.cartplus.order_received already covered the order arriving.
    const fx = await setupOrder(930003, 'pending');

    await fireWebhook(
      {
        id: `evt_325_pend_${fx.portalOrderId}`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(
            fx.portalOrderId,
            'pending',
            9999,
            [{ id: fx.portalOrderId * 10, unitPrice: 9999, quantity: 1 }],
            fx.customerPhone,
          ),
        },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.updated',
    );

    expect(await changeRows(fx.requestId)).toHaveLength(0);
    expect(await changeNotifications(fx.requestId)).toHaveLength(0);
  });

  it('stays silent for a cosmetic edit at Order Confirmed', async () => {
    // Same money, same quantities — only the product name and SKU moved.
    // An alert that fires for a spelling fix gets swiped away along with the
    // ones that matter.
    const fx = await setupOrder(930004, 'confirmed');

    await fireWebhook(
      {
        id: `evt_325_cosmetic_${fx.portalOrderId}`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(
            fx.portalOrderId,
            'confirmed',
            4174,
            [
              {
                id: fx.portalOrderId * 10,
                name: 'Water Purifier (renamed)',
                sku: 'WP-RENAMED',
                unitPrice: 4174,
                quantity: 1,
              },
            ],
            fx.customerPhone,
          ),
        },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.updated',
    );

    expect(await changeRows(fx.requestId)).toHaveLength(0);
    expect(await changeNotifications(fx.requestId)).toHaveLength(0);

    // …but the rename still lands on the quotation. Silence is about the
    // alert, not about refusing the edit.
    const [quote] = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(eq(quotations.portalQuotationId, String(fx.portalOrderId)));
    expect(quote).toBeDefined();
  });

  it('records a second, later edit as its own row', async () => {
    // Append-only: the timeline has to show the whole sequence, not just the
    // latest state. CP-20260613-BYXYIL went through eight distinct totals.
    const fx = await setupOrder(930005, 'confirmed');

    for (const [i, total] of [6000, 7000].entries()) {
      await fireWebhook(
        {
          id: `evt_325_multi_${fx.portalOrderId}_${i}`,
          type: 'order.updated',
          store: { id: STORE_ID, slug: 'test', name: 'Test' },
          data: {
            order: orderPayload(
              fx.portalOrderId,
              'confirmed',
              total,
              [{ id: fx.portalOrderId * 10, unitPrice: total, quantity: 1 }],
              fx.customerPhone,
            ),
          },
          created_at: '2026-08-05T11:00:00Z',
        },
        'order.updated',
      );
    }

    const rows = (await changeRows(fx.requestId)).sort(
      (a, b) => Number(a.newTotalPaise) - Number(b.newTotalPaise),
    );
    expect(rows).toHaveLength(2);
    expect(Number(rows[0]!.previousTotalPaise)).toBe(417_400);
    expect(Number(rows[0]!.newTotalPaise)).toBe(600_000);
    // The second row's "previous" is the first row's "new" — each row reads
    // on its own without replaying the chain.
    expect(Number(rows[1]!.previousTotalPaise)).toBe(600_000);
    expect(Number(rows[1]!.newTotalPaise)).toBe(700_000);
  });
});
