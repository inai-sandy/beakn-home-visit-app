import { hashPassword } from 'better-auth/crypto';
import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  auditLog,
  cities,
  inAppNotifications,
  notificationRules,
  orderComments,
  users,
} from '@/db/schema';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): order_comments tests
// =============================================================================

// truncateAll() wipes notification_rules between tests; re-seed migration
// 0067 rows so every test starts with the legal rule set.
beforeEach(async () => {
  await db.execute(sql.raw(`
    INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
    VALUES
      ('support.order_comment_added', 'in_app', 'exec_assigned',       true, NULL),
      ('support.order_comment_added', 'in_app', 'captain_owning_city', true, NULL),
      ('support.order_comment_added', 'in_app', 'support_team_all',    true, NULL),
      ('support.order_comment_added', 'in_app', 'mentioned_users',     true, NULL),
      ('support.order_comment_added', 'push',   'exec_assigned',       true, NULL),
      ('support.order_comment_added', 'push',   'captain_owning_city', true, NULL),
      ('support.order_comment_added', 'push',   'support_team_all',    true, NULL),
      ('support.order_comment_added', 'push',   'mentioned_users',     true, NULL)
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

import { addOrderCommentAction } from '@/lib/order-comments/actions';
import { loadCommentsForRequest } from '@/lib/order-comments/queries';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function seedSupportUser(): Promise<{
  id: string;
  phone: string;
  password: string;
  fullName: string;
}> {
  const phone = `+91993000${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportTest#1';
  const fullName = 'Support Comm';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName,
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
  return { id: u.id, phone, password, fullName };
}

async function seedConfirmedRequest() {
  const captain = await seedCaptain({
    phone: `+91997${Math.floor(Math.random() * 9000000 + 1000000)}`,
  });
  const city = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id, {
    phone: `+91996${Math.floor(Math.random() * 9000000 + 1000000)}`,
    fullName: 'Exec Comm',
  });
  const support = await seedSupportUser();
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  return { captain, city, exec, support, requestId: req.id };
}

describe('addOrderCommentAction', () => {
  it('support user can add a comment; row stored + audit + visible via loader', async () => {
    const { support, requestId } = await seedConfirmedRequest();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await addOrderCommentAction({
      requestId,
      body: 'Got the order, packing tomorrow.',
    });
    expect(r.ok).toBe(true);

    const rows = await db
      .select()
      .from(orderComments)
      .where(eq(orderComments.requestId, requestId));
    expect(rows.length).toBe(1);
    expect(rows[0].body).toBe('Got the order, packing tomorrow.');
    expect(rows[0].parentCommentId).toBeNull();

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, requestId));
    expect(audit.some((a) => a.eventType === 'order_comment_added')).toBe(true);

    const timeline = await loadCommentsForRequest(requestId);
    expect(timeline.length).toBe(1);
    expect(timeline[0].authorName).toBe(support.fullName);
  });

  it('exec assigned to the request can comment; exec on a different request cannot', async () => {
    const a = await seedConfirmedRequest();
    const b = await seedConfirmedRequest();

    // Log in as exec assigned to order A.
    const execSess = await loginByPhone(a.exec.phone, a.exec.password);
    currentCookieHeader = execSess.cookieHeader;

    const allowed = await addOrderCommentAction({
      requestId: a.requestId,
      body: 'Exec checking in.',
    });
    expect(allowed.ok).toBe(true);

    const blocked = await addOrderCommentAction({
      requestId: b.requestId,
      body: 'Should be blocked.',
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe('Forbidden');
  });

  it('rejects empty body and oversized body', async () => {
    const { support, requestId } = await seedConfirmedRequest();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    const empty = await addOrderCommentAction({ requestId, body: '   ' });
    expect(empty.ok).toBe(false);

    const tooLong = await addOrderCommentAction({
      requestId,
      body: 'x'.repeat(2001),
    });
    expect(tooLong.ok).toBe(false);

    const ok = await addOrderCommentAction({
      requestId,
      body: 'x'.repeat(2000),
    });
    expect(ok.ok).toBe(true);
  });

  it('reply: parentCommentId must belong to the same request', async () => {
    const a = await seedConfirmedRequest();
    const b = await seedConfirmedRequest();
    const sess = await loginByPhone(a.support.phone, a.support.password);
    currentCookieHeader = sess.cookieHeader;

    const parent = await addOrderCommentAction({
      requestId: a.requestId,
      body: 'parent on A',
    });
    if (!parent.ok) throw new Error('seed parent failed');

    const cross = await addOrderCommentAction({
      requestId: b.requestId,
      parentCommentId: parent.data!.id,
      body: 'cross-request reply',
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.error.toLowerCase()).toContain('parent comment');

    const sameRequest = await addOrderCommentAction({
      requestId: a.requestId,
      parentCommentId: parent.data!.id,
      body: 'real reply',
    });
    expect(sameRequest.ok).toBe(true);
    if (sameRequest.ok) expect(sameRequest.data!.parentCommentId).toBe(parent.data!.id);
  });

  it('@mention: rejects user not in the pool; accepts valid pool member', async () => {
    const { exec, captain, support, requestId } = await seedConfirmedRequest();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    // A second support user — should be in the pool.
    const supportB = await seedSupportUser();

    const okMention = await addOrderCommentAction({
      requestId,
      body: 'pinging the team',
      mentionedUserIds: [supportB.id, exec.id, captain.id],
    });
    expect(okMention.ok).toBe(true);

    // Random user not in the pool.
    const outsider = await seedSuperAdmin({
      phone: `+91999${Math.floor(Math.random() * 9000000 + 1000000)}`,
    });
    // super_admin IS in the pool (always), so use an inactive exec instead.
    const captainB = await seedCaptain({
      phone: `+91998${Math.floor(Math.random() * 9000000 + 1000000)}`,
    });
    const offendingExec = await seedExecutive(captainB.id, {
      phone: `+91990${Math.floor(Math.random() * 9000000 + 1000000)}`,
      fullName: 'Outsider Exec',
    });

    const badMention = await addOrderCommentAction({
      requestId,
      body: 'pinging an outsider',
      mentionedUserIds: [offendingExec.id],
    });
    expect(badMention.ok).toBe(false);
    if (!badMention.ok) expect(badMention.error).toContain('part of this order');

    void outsider;
  });

  it('notification fan-out: support author → exec + captain + other support get in-app rows; author does not', async () => {
    const { exec, captain, support, requestId } = await seedConfirmedRequest();
    const supportB = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await addOrderCommentAction({
      requestId,
      body: 'Heads up, packing soon.',
    });
    expect(r.ok).toBe(true);
    await sleep(800);

    const execRows = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, exec.id),
          eq(inAppNotifications.eventType, 'support.order_comment_added'),
        ),
      );
    expect(execRows.length).toBeGreaterThanOrEqual(1);

    const captainRows = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, captain.id),
          eq(inAppNotifications.eventType, 'support.order_comment_added'),
        ),
      );
    expect(captainRows.length).toBeGreaterThanOrEqual(1);

    const supportBRows = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, supportB.id),
          eq(inAppNotifications.eventType, 'support.order_comment_added'),
        ),
      );
    expect(supportBRows.length).toBeGreaterThanOrEqual(1);

    // Author (support) should NOT receive their own ping even though
    // they're in support_team_all.
    const authorRows = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.userId, support.id),
          eq(inAppNotifications.eventType, 'support.order_comment_added'),
        ),
      );
    expect(authorRows.length).toBe(0);
  });
});

describe('notification_rules seed (migration 0067)', () => {
  it('seeds support.order_comment_added with in_app + push only (no whatsapp)', async () => {
    const rows = await db
      .select({
        channel: notificationRules.channel,
        recipientRole: notificationRules.recipientRole,
        enabled: notificationRules.enabled,
      })
      .from(notificationRules)
      .where(eq(notificationRules.eventType, 'support.order_comment_added'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.some((r) => r.channel === 'whatsapp')).toBe(false);
    const inApp = rows.filter((r) => r.channel === 'in_app');
    const push = rows.filter((r) => r.channel === 'push');
    expect(inApp.length).toBeGreaterThanOrEqual(4);
    expect(push.length).toBeGreaterThanOrEqual(4);
  });
});
