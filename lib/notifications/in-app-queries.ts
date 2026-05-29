// HVA-52: read-side helpers for the in-app notification drawer.
//
// The engine (lib/notifications/engine.ts via channels/in-app.ts) is the
// write side — it inserts rows into `in_app_notifications` whenever an
// event fires that matches a notification_rule with channel='in_app' and a
// recipient_role that resolves to this user. These helpers surface the
// rows.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { inAppNotifications } from '@/db/schema';

export interface InAppNotificationRow {
  id: string;
  eventType: string;
  title: string;
  body: string;
  linkUrl: string | null;
  createdAt: Date;
  readAt: Date | null;
}

/** Used for the bell badge count. Cheap — composite index covers it. */
export async function loadUnreadInAppCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(inAppNotifications)
    .where(
      and(eq(inAppNotifications.userId, userId), isNull(inAppNotifications.readAt)),
    );
  return row?.cnt ?? 0;
}

/**
 * Most-recent items for the drawer feed. Returns both read + unread so the
 * user can scan history; unread state surfaces via the `readAt === null`
 * dot in the UI.
 */
export async function loadRecentInAppNotifications(
  userId: string,
  limit = 20,
): Promise<InAppNotificationRow[]> {
  return db
    .select({
      id: inAppNotifications.id,
      eventType: inAppNotifications.eventType,
      title: inAppNotifications.title,
      body: inAppNotifications.body,
      linkUrl: inAppNotifications.linkUrl,
      createdAt: inAppNotifications.createdAt,
      readAt: inAppNotifications.readAt,
    })
    .from(inAppNotifications)
    .where(eq(inAppNotifications.userId, userId))
    .orderBy(desc(inAppNotifications.createdAt))
    .limit(limit);
}
