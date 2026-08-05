import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import {
  cities,
  inAppNotifications,
  notificationRules,
  quotations,
  requestStatusHistory,
  tasks,
  users,
  visitRequests,
  webhookSecrets,
} from '@/db/schema';
import { computeCartplusSignature } from '@/lib/webhooks/cartplus/verify';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-326: a CartPlus cancellation must reach the team, exactly once
// =============================================================================
//
// Two bugs, one test file.
//
// 1. NOBODY WAS TOLD. Both CartPlus cancel routes set cancelled_at and
//    stopped. Four production requests were cancelled this way with zero
//    notifications — including cancellations that landed after installation
//    had been scheduled.
//
// 2. THE TWO ROUTES DISAGREED. CartPlus normally sends `order.updated`
//    (status `cancelled`) and then `order.cancelled` ~200ms later. The first
//    ran the full path — history row, cleared appointment. The second only
//    flipped the flag. Whenever they paired up the fuller path happened to
//    run first and the thin one no-opped, so the difference stayed hidden.
//    It is not hidden when they don't pair: on 2026-06-14 a bare
//    `order.cancelled` arrived for CP-20260613-IJJOST with no `order.updated`
//    at all, and that request got no timeline row and no calendar cleanup.
//
// So the tests below fire the bare event ALONE (the case that was broken)
// and the pair TOGETHER (to prove one notification, not two).
// =============================================================================

const TEST_SECRET = 'cartplus_326_test_secret_bbbbbbbbbbbbbbbbbbbbbbbbbb';
const STORE_ID = 32601;

// users.portal_exec_id is UNIQUE, and one test seeds two orders without a
// truncate in between — so the mapping id has to be per-order, not a shared
// constant.
function portalExecIdFor(portalOrderId: number): number {
  return portalOrderId + 500_000;
}

let seq = 0;
function nextDigits(): string {
  seq += 1;
  return String(3000 + seq).padStart(4, '0');
}

beforeEach(async () => {
  // truncateAll wipes notification_rules, so the rules migration 0088 seeds
  // have to be re-seeded per test. in_app only — HVA-326 ships no WhatsApp
  // rule, and push reuses the in_app composer.
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
        eventType: 'request.cancelled_in_cartplus',
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
        'x-cartplus-delivery': `dlv_326_${nextDigits()}`,
      },
      body,
    }) as never,
  );
}

function orderPayload(portalOrderId: number, status: string) {
  return {
    id: portalOrderId,
    order_number: `CP-326-${portalOrderId}`,
    status,
    payment_status: 'paid',
    fulfillment_status: 'pending',
    currency: 'INR',
    total_amount: 4174,
    placed_at: '2026-08-05T10:00:00Z',
    items: [
      {
        id: portalOrderId * 10,
        product_id: 901,
        name: 'Water Purifier',
        sku: 'WP-001',
        unit_price: 4174,
        quantity: 1,
        line_total: 4174,
        notes: null,
      },
    ],
    created_by: {
      id: portalExecIdFor(portalOrderId),
      name: 'Exec H326',
      email: null,
    },
    customer: {
      id: 501,
      name: 'Cancel Test Customer',
      phone: `+9198111${nextDigits()}`,
      email: null,
    },
  };
}

interface Fixture {
  requestId: string;
  portalOrderId: number;
  execId: string;
  captainId: string;
  supportId: string;
  adminId: string;
  taskId: string;
}

/**
 * A request sitting at Installation Scheduled with a real installation
 * appointment on the calendar — the state Sandeep called out as the one that
 * matters ("though it might be in the installation phase").
 */
async function setupInstallationScheduledOrder(
  portalOrderId: number,
): Promise<Fixture> {
  const admin = await seedSuperAdmin({ phone: `+91998326${nextDigits()}` });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });

  const captain = await seedCaptain({ phone: `+91998326${nextDigits()}` });
  const exec = await seedExecutive(captain.id, {
    phone: `+91998326${nextDigits()}`,
    fullName: 'Exec H326',
  });
  // support_team_all resolves off users.role alone — no profile row needed.
  const [support] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support H326',
      phone: `+91998326${nextDigits()}`,
      phoneVerified: true,
      isActive: true,
    })
    .returning({ id: users.id });

  const city = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    // captainUserId is what the captain_owning_city resolver reads.
    .set({ cartplusStoreId: STORE_ID, captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  await db
    .update(users)
    .set({ portalExecId: portalExecIdFor(portalOrderId) })
    .where(eq(users.id, exec.id));

  await fireWebhook(
    {
      id: `evt_326_create_${portalOrderId}`,
      type: 'order.created',
      store: { id: STORE_ID, slug: 'test', name: 'Test' },
      data: { order: orderPayload(portalOrderId, 'confirmed') },
      created_at: '2026-08-05T10:00:00Z',
    },
    'order.created',
  );

  const [quote] = await db
    .select({ requestId: quotations.visitRequestId })
    .from(quotations)
    .where(eq(quotations.portalQuotationId, String(portalOrderId)));
  const requestId = quote!.requestId;

  // Advance to Installation Scheduled and put the appointment on a calendar.
  const stage = await getStatusStage('INSTALLATION_SCHEDULED');
  await db
    .update(visitRequests)
    .set({ statusStageId: stage.id })
    .where(eq(visitRequests.id, requestId));

  const [task] = await db
    .insert(tasks)
    .values({
      execUserId: exec.id,
      taskType: 'Installation & Activation',
      description: 'Installation for Cancel Test Customer',
      estimatedTime: '2h',
      taskDate: '2026-08-12',
      linkRequestId: requestId,
      status: 'pending',
    })
    .returning({ id: tasks.id });

  // Notifications raised by order.created are not what we're measuring.
  await db
    .delete(inAppNotifications)
    .where(eq(inAppNotifications.eventType, 'webhook.cartplus.order_received'));

  return {
    requestId,
    portalOrderId,
    execId: exec.id,
    captainId: captain.id,
    supportId: support!.id,
    adminId: admin.id,
    taskId: task!.id,
  };
}

async function cancelNotifications(requestId: string) {
  return db
    .select({ userId: inAppNotifications.userId, body: inAppNotifications.body })
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.eventType, 'request.cancelled_in_cartplus'),
        eq(inAppNotifications.linkUrl, `/requests/${requestId}`),
      ),
    );
}

describe('CartPlus cancellation reaches the team', () => {
  it('a BARE order.cancelled does the full job — flag, timeline, calendar, notification', async () => {
    const fx = await setupInstallationScheduledOrder(920001);

    // Deliberately NO preceding order.updated. This is the 2026-06-14
    // CP-20260613-IJJOST case, which pre-fix only flipped cancelled_at.
    const res = await fireWebhook(
      {
        id: `evt_326_cancel_${fx.portalOrderId}`,
        type: 'order.cancelled',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(fx.portalOrderId, 'cancelled') },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.cancelled',
    );
    expect(res.status).toBe(200);

    const [request] = await db
      .select({
        cancelledAt: visitRequests.cancelledAt,
        reasonCode: visitRequests.cancellationReasonCode,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, fx.requestId));
    expect(request!.cancelledAt).not.toBeNull();
    expect(request!.reasonCode).toBe('portal_cancelled');

    // Pre-fix: no history row on this route at all.
    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, fx.requestId));
    expect(
      history.filter((h) =>
        (h.reason ?? '').startsWith('CANCELLED_BY_CUSTOMER:'),
      ),
    ).toHaveLength(1);

    // Pre-fix: the installation stayed on the calendar.
    const [task] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, fx.taskId));
    expect(task!.status).toBe('cancelled');

    // Pre-fix: zero notifications.
    const notified = await cancelNotifications(fx.requestId);
    expect(notified.map((n) => n.userId).sort()).toEqual(
      [fx.execId, fx.captainId, fx.supportId, fx.adminId].sort(),
    );
  });

  it('names the stage it was cancelled at', async () => {
    const fx = await setupInstallationScheduledOrder(920002);

    await fireWebhook(
      {
        id: `evt_326_cancel_${fx.portalOrderId}`,
        type: 'order.cancelled',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(fx.portalOrderId, 'cancelled') },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.cancelled',
    );

    const notified = await cancelNotifications(fx.requestId);
    expect(notified.length).toBeGreaterThan(0);
    // "cancelled" at Installation Scheduled is a different problem from
    // "cancelled" at Quotation Given, and the message has to say which.
    for (const row of notified) {
      expect(row.body).toContain('Installation Scheduled');
    }
  });

  it('the usual order.updated + order.cancelled pair notifies ONCE, not twice', async () => {
    const fx = await setupInstallationScheduledOrder(920003);

    // Exactly what production sends, in the order it sends it.
    await fireWebhook(
      {
        id: `evt_326_upd_${fx.portalOrderId}`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(fx.portalOrderId, 'cancelled') },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.updated',
    );
    await fireWebhook(
      {
        id: `evt_326_cancel_${fx.portalOrderId}`,
        type: 'order.cancelled',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(fx.portalOrderId, 'cancelled') },
        created_at: '2026-08-05T11:00:01Z',
      },
      'order.cancelled',
    );

    const notified = await cancelNotifications(fx.requestId);
    // Four recipients, one notification each. Eight would mean the second
    // delivery re-announced a cancellation that had already happened.
    expect(notified).toHaveLength(4);

    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, fx.requestId));
    expect(
      history.filter((h) =>
        (h.reason ?? '').startsWith('CANCELLED_BY_CUSTOMER:'),
      ),
    ).toHaveLength(1);
  });

  it('both cancel routes leave the request in the same state', async () => {
    // The equivalence the fix is really about: whichever event arrives
    // alone, the outcome is identical.
    const viaBare = await setupInstallationScheduledOrder(920004);
    await fireWebhook(
      {
        id: `evt_326_bare_${viaBare.portalOrderId}`,
        type: 'order.cancelled',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(viaBare.portalOrderId, 'cancelled') },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.cancelled',
    );

    const viaUpdate = await setupInstallationScheduledOrder(920005);
    await fireWebhook(
      {
        id: `evt_326_updonly_${viaUpdate.portalOrderId}`,
        type: 'order.updated',
        store: { id: STORE_ID, slug: 'test', name: 'Test' },
        data: { order: orderPayload(viaUpdate.portalOrderId, 'cancelled') },
        created_at: '2026-08-05T11:00:00Z',
      },
      'order.updated',
    );

    for (const fx of [viaBare, viaUpdate]) {
      const [request] = await db
        .select({
          cancelledAt: visitRequests.cancelledAt,
          reasonCode: visitRequests.cancellationReasonCode,
          actor: visitRequests.cancellationActor,
        })
        .from(visitRequests)
        .where(eq(visitRequests.id, fx.requestId));
      const [task] = await db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, fx.taskId));
      const history = await db
        .select({ reason: requestStatusHistory.reason })
        .from(requestStatusHistory)
        .where(eq(requestStatusHistory.requestId, fx.requestId));
      const notified = await cancelNotifications(fx.requestId);

      expect(request!.cancelledAt).not.toBeNull();
      expect(request!.reasonCode).toBe('portal_cancelled');
      expect(request!.actor).toBe('customer');
      expect(task!.status).toBe('cancelled');
      expect(
        history.filter((h) =>
          (h.reason ?? '').startsWith('CANCELLED_BY_CUSTOMER:'),
        ),
      ).toHaveLength(1);

      // Not an exact count: this test seeds two fixtures without a truncate
      // between them, and support_team_all / super_admin are broadcast roles
      // — they correctly reach every support user and every admin that
      // exists by then, including the other fixture's. The properties that
      // matter are that this request's own four people were told, and that
      // nobody was told twice.
      const userIds = notified.map((n) => n.userId);
      expect(new Set(userIds).size).toBe(userIds.length);
      for (const expected of [
        fx.execId,
        fx.captainId,
        fx.supportId,
        fx.adminId,
      ]) {
        expect(userIds).toContain(expected);
      }
    }
  });
});
