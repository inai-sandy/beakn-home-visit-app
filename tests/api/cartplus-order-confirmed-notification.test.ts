import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import {
  cities,
  inAppNotifications,
  notificationRules,
  quotations,
  statusStages,
  users,
  visitRequests,
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
// HVA-341: a CartPlus-confirmed order must reach the support team
// =============================================================================
//
// `support.order_ready_for_dispatch` lived in the manual advance engine only.
// The webhook path reaches ORDER_CONFIRMED through applyCartplusOrderStatus,
// which never dispatched it — so an order CartPlus confirmed dropped into the
// dispatch queue with nobody told.
//
// Production before this shipped: 8 CartPlus confirmations, 0 notifications.
// The only three that ever fired (2026-06-12, 08-03, 08-04) were manual
// advances. It stayed survivable because half of all confirmations were still
// being made by hand — and HVA-341 removes exactly that half, which is why
// this had to ship in the same release as the button gate.
//
// The confirmation can arrive two ways and both are covered here: an order
// that lands already `confirmed` (order.created) and one confirmed days later
// (order.status_changed). They share one helper precisely so they cannot
// drift the way the manual and webhook paths did.
// =============================================================================

const TEST_SECRET = 'cartplus_341_test_secret_cccccccccccccccccccccccccc';
const STORE_ID = 34101;

function portalExecIdFor(portalOrderId: number): number {
  return portalOrderId + 700_000;
}

let seq = 0;
function nextDigits(): string {
  seq += 1;
  return String(4000 + seq).padStart(4, '0');
}

beforeEach(async () => {
  // truncateAll wipes notification_rules, so the seeded rules have to come
  // back per test. in_app only — push reuses the same composer.
  await db
    .insert(notificationRules)
    .values([
      {
        eventType: 'support.order_ready_for_dispatch',
        channel: 'in_app' as const,
        recipientRole: 'support_team_all',
        enabled: true,
        templateKey: null,
      },
      // HVA-345: the exec + captain rules migration 0095 seeds.
      {
        eventType: 'webhook.cartplus.order_confirmed',
        channel: 'in_app' as const,
        recipientRole: 'exec_assigned',
        enabled: true,
        templateKey: null,
      },
      {
        eventType: 'webhook.cartplus.order_confirmed',
        channel: 'in_app' as const,
        recipientRole: 'captain_owning_city',
        enabled: true,
        templateKey: null,
      },
    ])
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
        'x-cartplus-delivery': `dlv_341_${nextDigits()}`,
      },
      body,
    }) as never,
  );
}

interface ItemSpec {
  id: number;
  name: string;
}

function orderPayload(
  portalOrderId: number,
  status: string,
  items: ItemSpec[],
) {
  return {
    id: portalOrderId,
    order_number: `CP-341-${portalOrderId}`,
    status,
    payment_status: 'pending',
    fulfillment_status: 'pending',
    currency: 'INR',
    total_amount: 1000 * items.length,
    placed_at: '2026-08-19T10:00:00Z',
    items: items.map((item) => ({
      id: item.id,
      product_id: 900 + item.id,
      name: item.name,
      sku: `SKU-${item.id}`,
      unit_price: 1000,
      quantity: 1,
      line_total: 1000,
      notes: null,
    })),
    created_by: {
      id: portalExecIdFor(portalOrderId),
      name: 'Exec H341',
      email: null,
    },
    customer: {
      id: 601,
      name: 'Confirm Test Customer',
      phone: `+9198341${nextDigits()}`,
      email: null,
    },
  };
}

/** Seeds the secret, the store→city mapping, the exec mapping and a support
 *  user, so the webhook can land and `support_team_all` has someone to tell. */
async function setupWorld(
  portalOrderId: number,
): Promise<{ supportId: string; execId: string; captainId: string }> {
  const admin = await seedSuperAdmin({ phone: `+91998341${nextDigits()}` });
  await db
    .insert(webhookSecrets)
    .values({
      provider: 'cartplus',
      secret: TEST_SECRET,
      secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
      createdByUserId: admin.id,
    })
    .onConflictDoNothing();

  const captain = await seedCaptain({ phone: `+91998341${nextDigits()}` });
  const exec = await seedExecutive(captain.id, {
    phone: `+91998341${nextDigits()}`,
    fullName: 'Exec H341',
  });
  // support_team_all resolves off users.role alone.
  const [support] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support H341',
      phone: `+91998341${nextDigits()}`,
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

  return { supportId: support.id, execId: exec.id, captainId: captain.id };
}

async function supportNotifications(supportId: string) {
  return notificationsFor(supportId);
}

async function notificationsFor(userId: string) {
  return db
    .select({
      title: inAppNotifications.title,
      body: inAppNotifications.body,
      linkUrl: inAppNotifications.linkUrl,
    })
    .from(inAppNotifications)
    .where(eq(inAppNotifications.userId, userId));
}

async function requestIdFor(portalOrderId: number): Promise<string> {
  const [quote] = await db
    .select({ requestId: quotations.visitRequestId })
    .from(quotations)
    .where(eq(quotations.portalQuotationId, String(portalOrderId)));
  return quote!.requestId;
}

async function stageCodeOf(requestId: string): Promise<string> {
  const [row] = await db
    .select({ code: statusStages.code })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestId))
    .limit(1);
  return row.code;
}

describe('HVA-341: CartPlus confirmation tells support', () => {
  it('says nothing while the order is still pending', async () => {
    const portalOrderId = 34101001;
    const { supportId } = await setupWorld(portalOrderId);

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_a`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(portalOrderId, 'pending', [
            { id: 1, name: 'Smart Lock' },
          ]),
        },
        created_at: '2026-08-19T10:00:00Z',
      },
      'order.created',
    );

    const requestId = await requestIdFor(portalOrderId);
    expect(await stageCodeOf(requestId)).toBe('QUOTATION_GIVEN');
    // A quotation is not an order. Support has nothing to ship yet.
    expect(await supportNotifications(supportId)).toHaveLength(0);
  });

  it('notifies when a later status_changed confirms the order', async () => {
    // This is Sandeep's path: the order arrives, he confirms it in CartPlus
    // some time afterwards, and the portal follows.
    const portalOrderId = 34101002;
    const { supportId } = await setupWorld(portalOrderId);
    const items = [
      { id: 21, name: 'Smart Lock' },
      { id: 22, name: 'Curtain Motor' },
    ];

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_a`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(portalOrderId, 'pending', items) },
        created_at: '2026-08-19T10:00:00Z',
      },
      'order.created',
    );
    expect(await supportNotifications(supportId)).toHaveLength(0);

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_b`,
        type: 'order.status_changed',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(portalOrderId, 'confirmed', items) },
        created_at: '2026-08-19T10:05:00Z',
      },
      'order.status_changed',
    );

    const requestId = await requestIdFor(portalOrderId);
    expect(await stageCodeOf(requestId)).toBe('ORDER_CONFIRMED');

    const notes = await supportNotifications(supportId);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain('Confirm Test Customer');
    expect(notes[0].body).toContain('2 items');
    expect(notes[0].linkUrl).toContain(requestId);
  });

  it('notifies when the order arrives already confirmed', async () => {
    // Same helper as the path above, so "arrived confirmed" and "confirmed
    // later" cannot drift apart.
    const portalOrderId = 34101003;
    const { supportId } = await setupWorld(portalOrderId);

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_a`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(portalOrderId, 'confirmed', [
            { id: 31, name: 'Smart Lock' },
          ]),
        },
        created_at: '2026-08-19T10:00:00Z',
      },
      'order.created',
    );

    const notes = await supportNotifications(supportId);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('1 item');
  });

  it('tells support once, not twice, for CartPlus’s duplicate delivery', async () => {
    // CartPlus sends order.updated and order.status_changed ~200ms apart for
    // one action. `advanced` is only true on the first, so support hears once.
    const portalOrderId = 34101004;
    const { supportId } = await setupWorld(portalOrderId);
    const items = [{ id: 41, name: 'Smart Lock' }];

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_a`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(portalOrderId, 'pending', items) },
        created_at: '2026-08-19T10:00:00Z',
      },
      'order.created',
    );

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_b`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(portalOrderId, 'confirmed', items) },
        created_at: '2026-08-19T10:05:00Z',
      },
      'order.updated',
    );
    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_c`,
        type: 'order.status_changed',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(portalOrderId, 'confirmed', items) },
        created_at: '2026-08-19T10:05:00Z',
      },
      'order.status_changed',
    );

    expect(await supportNotifications(supportId)).toHaveLength(1);
  });

  it('counts only live items — one the customer dropped is not work', async () => {
    // HVA-340: an item removed by a CartPlus edit is soft-removed, not
    // deleted. Counting it would tell support to pull stock that is no longer
    // on the order.
    const portalOrderId = 34101005;
    const { supportId } = await setupWorld(portalOrderId);

    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_a`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(portalOrderId, 'pending', [
            { id: 51, name: 'Smart Lock' },
            { id: 52, name: 'Curtain Motor' },
            { id: 53, name: 'Video Doorbell' },
          ]),
        },
        created_at: '2026-08-19T10:00:00Z',
      },
      'order.created',
    );

    // The customer drops two products and confirms what is left.
    await fireWebhook(
      {
        id: `evt_341_${portalOrderId}_b`,
        type: 'order.status_changed',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(portalOrderId, 'confirmed', [
            { id: 51, name: 'Smart Lock' },
          ]),
        },
        created_at: '2026-08-19T10:05:00Z',
      },
      'order.status_changed',
    );

    const notes = await supportNotifications(supportId);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('1 item');
    expect(notes[0].body).not.toContain('3 items');
  });
});

// =============================================================================
// HVA-345: the same confirmation must also reach the exec and the captain
// =============================================================================
//
// HVA-341 above wired support in. The exec who owns the order and the captain
// who owns the city heard nothing — since HVA-341 removed the portal's Order
// Confirmed button, CartPlus is the only route to ORDER_CONFIRMED, so the
// moment a sale is booked reached nobody who is measured on it.
// =============================================================================

describe('HVA-345: CartPlus confirmation also tells the exec and the captain', () => {
  it('says nothing while the order is still pending', async () => {
    const { execId, captainId } = await setupWorld(34_550);
    await fireWebhook(
      {
        id: `evt_345_34_550_order_created`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_550, 'pending', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.created',
    );
    expect(await notificationsFor(execId)).toHaveLength(0);
    expect(await notificationsFor(captainId)).toHaveLength(0);
  });

  it('tells both when a later status_changed confirms the order', async () => {
    const { execId, captainId } = await setupWorld(34_551);
    await fireWebhook(
      {
        id: `evt_345_34_551_order_created`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_551, 'pending', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.created',
    );
    await fireWebhook(
      {
        id: `evt_345_34_551_order_status_changed`,
        type: 'order.status_changed',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_551, 'confirmed', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.status_changed',
    );

    const execRows = await notificationsFor(execId);
    const captainRows = await notificationsFor(captainId);
    expect(execRows).toHaveLength(1);
    expect(captainRows).toHaveLength(1);
    expect(execRows[0].title).toContain('Order confirmed');

    // The two roles have different pages; a captain sent to /requests/[id]
    // lands somewhere they are not meant to be.
    expect(execRows[0].linkUrl).toContain('/requests/');
    expect(execRows[0].linkUrl).not.toContain('/captain/');
    expect(captainRows[0].linkUrl).toContain('/captain/requests/');

    // The captain is reading a city's worth of these — the value is what
    // makes one worth opening.
    expect(captainRows[0].body).toContain('₹1,000');
    expect(captainRows[0].body).toContain('booked business');
  });

  it('tells both when the order arrives already confirmed', async () => {
    const { execId, captainId } = await setupWorld(34_552);
    await fireWebhook(
      {
        id: `evt_345_34_552_order_created`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_552, 'confirmed', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.created',
    );
    expect(await notificationsFor(execId)).toHaveLength(1);
    expect(await notificationsFor(captainId)).toHaveLength(1);
  });

  it('announces once, not twice, for CartPlus’s duplicate delivery', async () => {
    const { execId, captainId } = await setupWorld(34_553);
    await fireWebhook(
      {
        id: `evt_345_34_553_order_created`,
        type: 'order.created',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_553, 'pending', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.created',
    );
    // CartPlus sends order.updated and order.status_changed ~200ms apart for
    // one confirmation. Forward-only advance means only the first reports.
    await fireWebhook(
      {
        id: `evt_345_34_553_order_updated`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_553, 'confirmed', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.updated',
    );
    await fireWebhook(
      {
        id: `evt_345_34_553_order_status_changed`,
        type: 'order.status_changed',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: {
          order: orderPayload(34_553, 'confirmed', [{ id: 1, name: 'Smart Plug' }]),
        },
        created_at: '2026-08-21T10:00:00Z',
      },
      'order.status_changed',
    );
    expect(await notificationsFor(execId)).toHaveLength(1);
    expect(await notificationsFor(captainId)).toHaveLength(1);
  });
});
