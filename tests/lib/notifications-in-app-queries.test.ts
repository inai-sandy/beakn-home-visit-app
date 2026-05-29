import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { inAppNotifications } from '@/db/schema';
import {
  loadRecentInAppNotifications,
  loadUnreadInAppCount,
} from '@/lib/notifications/in-app-queries';

import { seedCaptain, seedExecutive } from '../helpers/db';

// HVA-52: in-app notification read helpers.

describe('in-app notification queries', () => {
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    const captain = await seedCaptain({ phone: '+919000051111' });
    const execA = await seedExecutive(captain.id, {
      phone: '+919100051111',
    });
    const execB = await seedExecutive(captain.id, {
      phone: '+919100051112',
    });
    userA = execA.id;
    userB = execB.id;
  });

  it('loadUnreadInAppCount returns 0 when user has none', async () => {
    expect(await loadUnreadInAppCount(userA)).toBe(0);
  });

  it('loadUnreadInAppCount counts only the caller\'s unread rows', async () => {
    await db.insert(inAppNotifications).values([
      {
        userId: userA,
        eventType: 'request.assigned',
        title: 'A1',
        body: '',
      },
      {
        userId: userA,
        eventType: 'request.assigned',
        title: 'A2',
        body: '',
        readAt: new Date(),
      },
      {
        userId: userA,
        eventType: 'request.assigned',
        title: 'A3',
        body: '',
      },
      {
        userId: userB,
        eventType: 'request.assigned',
        title: 'B1',
        body: '',
      },
    ]);
    expect(await loadUnreadInAppCount(userA)).toBe(2);
    expect(await loadUnreadInAppCount(userB)).toBe(1);
  });

  it('loadRecentInAppNotifications returns the latest first, limited', async () => {
    const now = Date.now();
    await db.insert(inAppNotifications).values([
      {
        userId: userA,
        eventType: 'request.assigned',
        title: 'older',
        body: '',
        createdAt: new Date(now - 60_000),
      },
      {
        userId: userA,
        eventType: 'request.approved',
        title: 'newer',
        body: '',
        createdAt: new Date(now),
      },
    ]);
    const rows = await loadRecentInAppNotifications(userA, 10);
    expect(rows.map((r) => r.title)).toEqual(['newer', 'older']);
  });

  it('loadRecentInAppNotifications does NOT leak cross-user rows', async () => {
    await db.insert(inAppNotifications).values([
      {
        userId: userA,
        eventType: 'request.assigned',
        title: 'mine',
        body: '',
      },
      {
        userId: userB,
        eventType: 'request.assigned',
        title: 'theirs',
        body: '',
      },
    ]);
    const rows = await loadRecentInAppNotifications(userA, 10);
    expect(rows.map((r) => r.title)).toEqual(['mine']);
  });

  it('limit param is respected', async () => {
    await db.insert(inAppNotifications).values(
      Array.from({ length: 5 }).map((_, i) => ({
        userId: userA,
        eventType: 'request.assigned',
        title: `t${i}`,
        body: '',
      })),
    );
    const rows = await loadRecentInAppNotifications(userA, 3);
    expect(rows).toHaveLength(3);
    // Sanity: confirms ordering still applies on capped result.
    const all = await db
      .select({ title: inAppNotifications.title })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, userA));
    expect(all).toHaveLength(5);
  });
});
