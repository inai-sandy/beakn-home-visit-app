import { hashPassword } from 'better-auth/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  inAppNotifications,
  notificationRules,
  quotationLineItems,
  quotations,
  users,
} from '@/db/schema';

// truncateAll() wipes notification_rules between tests; re-seed the
// migration 0066 rows here so each test starts with the same rule set
// the production DB has after the migration.
beforeEach(async () => {
  await db.execute(sql.raw(`
    INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
    VALUES
      ('support.order_ready_for_dispatch', 'in_app', 'support_team_all', true, NULL),
      ('support.order_ready_for_dispatch', 'push',   'support_team_all', true, NULL),
      ('support.dispatch_recorded', 'in_app',   'exec_assigned',         true,  NULL),
      ('support.dispatch_recorded', 'in_app',   'captain_owning_city',   true,  NULL),
      ('support.dispatch_recorded', 'push',     'exec_assigned',         true,  NULL),
      ('support.dispatch_recorded', 'push',     'captain_owning_city',   true,  NULL),
      ('support.dispatch_recorded', 'whatsapp', 'exec_assigned',         false, 'internal_items_dispatched_v1'),
      ('support.dispatch_recorded', 'whatsapp', 'captain_owning_city',   false, 'internal_items_dispatched_v1'),
      ('support.dispatch_advanced', 'in_app',   'exec_assigned',         true,  NULL),
      ('support.dispatch_advanced', 'in_app',   'captain_owning_city',   true,  NULL),
      ('support.dispatch_advanced', 'push',     'exec_assigned',         true,  NULL),
      ('support.dispatch_advanced', 'push',     'captain_owning_city',   true,  NULL),
      ('support.dispatch_advanced', 'whatsapp', 'exec_assigned',         false, 'internal_dispatch_advanced_v1'),
      ('support.dispatch_advanced', 'whatsapp', 'captain_owning_city',   false, 'internal_dispatch_advanced_v1')
    ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
  `));
});

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { addDispatchAction } from '@/app/(support)/support/_actions/addDispatch';
import { advanceDispatchStageAction } from '@/app/(support)/support/_actions/advanceDispatchStage';
import {
  composeDispatchAdvancedInApp,
  composeDispatchRecordedInApp,
  composeOrderReadyForDispatchInApp,
} from '@/lib/notifications/compose/dispatch-events';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-240 (HVA-231 Phase 2 PR-C): dispatch notifications
// =============================================================================
//
// Composer tests (pure functions, no DB) + integration tests that
// trigger the action layers and assert the engine fanned out correctly.
// Migration 0066 seeds notification_rules with WhatsApp disabled by
// default; tests only verify in_app delivery since the testcontainer
// doesn't run web-push / WhatsApp providers.
// =============================================================================

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function seedSupportUser(): Promise<{
  id: string;
  phone: string;
  password: string;
}> {
  const phone = `+91992000${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support Notif',
      phone,
      phoneVerified: true,
      isActive: true,
      mustChangePassword: false,
    })
    .returning({ id: users.id });
  await db.insert(accounts).values({
    accountId: u.id,
    providerId: 'credential',
    userId: u.id,
    password: hash,
  });
  return { id: u.id, phone, password };
}

async function seedOrderWithItem(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  productName?: string;
  qty?: number;
}): Promise<{ requestId: string; lineItemId: string }> {
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  const [q] = await db
    .insert(quotations)
    .values({
      visitRequestId: req.id,
      totalOrderValuePaise: 100000,
      submittedByUserId: opts.execId,
    })
    .returning({ id: quotations.id });
  const [li] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: q.id,
      position: 1,
      productName: opts.productName ?? 'Notif Item',
      quantity: opts.qty ?? 3,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * (opts.qty ?? 3),
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id };
}

describe('composers (pure)', () => {
  it('composeOrderReadyForDispatchInApp renders title + body + linkUrl', () => {
    const out = composeOrderReadyForDispatchInApp({
      requestId: '019abcde-cafe-7000-8000-000000000001',
      customerName: 'Ravi Kumar',
      cityName: 'Hyderabad',
      itemCount: 3,
    });
    expect(out.title).toContain('Ravi Kumar');
    expect(out.body).toContain('3 items');
    expect(out.linkUrl).toContain('/support/orders/019abcde-cafe-7000-8000-000000000001');
  });

  it('composeDispatchRecordedInApp shows item summary + actor name', () => {
    const out = composeDispatchRecordedInApp({
      requestId: '019abcde-cafe-7000-8000-000000000001',
      dispatchId: '019abcde-cafe-7000-8000-000000000002',
      customerName: 'Ravi Kumar',
      dispatchedByName: 'Suresh (Support)',
      itemSummary: '3× KitchenLight, 1× CurtainMotor',
      totalItemsInDispatch: 4,
    });
    expect(out.title).toContain('Ravi Kumar');
    expect(out.body).toContain('3× KitchenLight');
    expect(out.body).toContain('Suresh (Support)');
    expect(out.linkUrl).toContain('/requests/');
  });

  it('composeDispatchAdvancedInApp varies copy by stage', () => {
    const packed = composeDispatchAdvancedInApp({
      requestId: '019abcde-cafe-7000-8000-000000000001',
      dispatchId: '019abcde-cafe-7000-8000-000000000002',
      customerName: 'Ravi',
      newStage: 'packed',
      changedByName: 'S',
    });
    expect(packed.title).toContain('packed');

    const handed = composeDispatchAdvancedInApp({
      requestId: '019abcde-cafe-7000-8000-000000000001',
      dispatchId: '019abcde-cafe-7000-8000-000000000002',
      customerName: 'Ravi',
      newStage: 'handed_off',
      changedByName: 'S',
    });
    expect(handed.title).toContain('handed off');
  });
});

describe('notification_rules seed (migration 0066)', () => {
  it('seeds 3 events with expected channels + WhatsApp disabled', async () => {
    const events = [
      'support.order_ready_for_dispatch',
      'support.dispatch_recorded',
      'support.dispatch_advanced',
    ];
    for (const event of events) {
      const rows = await db
        .select({
          channel: notificationRules.channel,
          recipientRole: notificationRules.recipientRole,
          enabled: notificationRules.enabled,
          templateKey: notificationRules.templateKey,
        })
        .from(notificationRules)
        .where(eq(notificationRules.eventType, event));
      expect(rows.length).toBeGreaterThan(0);
      const whatsappRows = rows.filter((r) => r.channel === 'whatsapp');
      for (const w of whatsappRows) {
        // WhatsApp ships disabled per spec; admin flips after Meta approves.
        expect(w.enabled).toBe(false);
        expect(w.templateKey).toBeTruthy();
      }
    }
  });
});

describe('addDispatchAction fan-out', () => {
  it('writes an in_app row for exec + captain on dispatch', async () => {
    const captain = await seedCaptain({ phone: '+919922000001' });
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(await import('@/db/schema').then((m) => m.cities))
      .set({ captainUserId: captain.id })
      .where(eq((await import('@/db/schema').then((m) => m.cities)).id, city.id));
    const exec = await seedExecutive(captain.id, {
      phone: '+919922000002',
      fullName: 'Exec Notif',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });

    const r = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
    });
    expect(r.ok).toBe(true);

    // setImmediate scheduled — let the microtask queue drain.
    await sleep(800);

    // Exec should have a row
    const execRows = await db
      .select({ id: inAppNotifications.id, body: inAppNotifications.body })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, exec.id));
    expect(execRows.length).toBeGreaterThanOrEqual(1);

    // Captain should have a row
    const captainRows = await db
      .select({ id: inAppNotifications.id, body: inAppNotifications.body })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, captain.id));
    expect(captainRows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('advanceDispatchStageAction fan-out', () => {
  it('writes notifications when stage advances', async () => {
    const captain = await seedCaptain({ phone: '+919923000001' });
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(await import('@/db/schema').then((m) => m.cities))
      .set({ captainUserId: captain.id })
      .where(eq((await import('@/db/schema').then((m) => m.cities)).id, city.id));
    const exec = await seedExecutive(captain.id, {
      phone: '+919923000002',
      fullName: 'Exec Adv',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });

    const dispatch = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!dispatch.ok) throw new Error('dispatch failed');
    await sleep(800);
    // Clear notifications from the dispatch-recorded event so we only
    // count advance notifications.
    await db
      .delete(inAppNotifications)
      .where(eq(inAppNotifications.userId, exec.id));
    await db
      .delete(inAppNotifications)
      .where(eq(inAppNotifications.userId, captain.id));

    const adv = await advanceDispatchStageAction({
      dispatchId: dispatch.data!.dispatchId,
      toStage: 'packed',
    });
    expect(adv.ok).toBe(true);
    await sleep(800);

    const execRows = await db
      .select({ id: inAppNotifications.id, body: inAppNotifications.body })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, exec.id));
    expect(execRows.length).toBeGreaterThanOrEqual(1);
    expect(
      execRows.some((r) => r.body.toLowerCase().includes('packed')),
    ).toBe(true);
  });
});

describe('support_team_all resolver', () => {
  it('order_ready_for_dispatch reaches every active support user', async () => {
    // Seed 2 support users to verify broadcast resolves to all of them.
    const supportA = await seedSupportUser();
    const supportB = await seedSupportUser();

    // Now build an order and transition it from QUOTATION_GIVEN → ORDER_CONFIRMED.
    const captain = await seedCaptain({ phone: '+919924000001' });
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(await import('@/db/schema').then((m) => m.cities))
      .set({ captainUserId: captain.id })
      .where(eq((await import('@/db/schema').then((m) => m.cities)).id, city.id));
    const exec = await seedExecutive(captain.id, {
      phone: '+919924000002',
      fullName: 'Exec Trans',
    });
    const admin = await seedSuperAdmin({ phone: '+919924000003' });

    // Use the status-transition path so the support broadcast fires.
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'QUOTATION_GIVEN',
    });
    const [q] = await db
      .insert(quotations)
      .values({
        visitRequestId: req.id,
        totalOrderValuePaise: 100000,
        submittedByUserId: exec.id,
      })
      .returning({ id: quotations.id });
    await db.insert(quotationLineItems).values({
      quotationId: q.id,
      position: 1,
      productName: 'TransItem',
      quantity: 1,
      unitPricePaise: 100000,
      lineTotalPaise: 100000,
    });

    const { transitionRequestStatus } = await import('@/lib/status-transition');
    const { getStatusStage } = await import('../helpers/db');
    const targetStage = await getStatusStage('ORDER_CONFIRMED');
    const result = await transitionRequestStatus({
      requestId: req.id,
      nextStatusId: targetStage.id,
      actorUserId: admin.id,
      actorRole: 'super_admin',
      allowForwardSkip: true,
    });
    expect(result.ok).toBe(true);
    await sleep(800);

    const rowsA = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, supportA.id),
          eq(inAppNotifications.eventType, 'support.order_ready_for_dispatch'),
        ),
      );
    const rowsB = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, supportB.id),
          eq(inAppNotifications.eventType, 'support.order_ready_for_dispatch'),
        ),
      );
    expect(rowsA.length).toBeGreaterThanOrEqual(1);
    expect(rowsB.length).toBeGreaterThanOrEqual(1);
  });
});
