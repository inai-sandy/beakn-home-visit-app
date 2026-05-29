import { and, desc, eq, gt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import { inAppNotifications } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  loadUnreadInAppCount,
  type InAppNotificationRow,
} from '@/lib/notifications/in-app-queries';

// HVA-53: client-polled endpoint that powers the toast + bell-badge live
// updates. The bell's drawer initial paint is still server-rendered through
// the layout; this endpoint only delivers deltas since the last tick.
//
// Phase 1 polling cadence is fixed at the client (30s, visibility-gated).
// Phase 2 swaps this for SSE (HVA-55) without changing the response shape —
// the SSE handler will stream the same `{ unreadCount, newItems }` payload.

export const dynamic = 'force-dynamic';

const MAX_NEW_ITEMS = 20;

interface PollResponse {
  unreadCount: number;
  newItems: InAppNotificationRow[];
  /** ISO timestamp the client should send on the next tick. */
  cursor: string;
}

export async function GET(request: Request): Promise<NextResponse<PollResponse | { error: string }>> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  // Tolerate a missing / malformed `since` — first tick from a freshly-opened
  // tab has nothing useful to send. We just return the current unread count
  // with no newItems; the client uses the returned cursor going forward.
  const since = sinceParam ? new Date(sinceParam) : null;

  let newItems: InAppNotificationRow[] = [];
  if (since !== null && !Number.isNaN(since.getTime())) {
    newItems = await db
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
      .where(
        and(
          eq(inAppNotifications.userId, userId),
          gt(inAppNotifications.createdAt, since),
        ),
      )
      .orderBy(desc(inAppNotifications.createdAt))
      .limit(MAX_NEW_ITEMS);
  }

  const unreadCount = await loadUnreadInAppCount(userId);

  // The cursor for the next tick is the newest item we just returned, or the
  // current server time if no new items landed. The +1ms is intentional so
  // the next tick's `gt(createdAt, cursor)` doesn't return the same row.
  const newestTs =
    newItems.length > 0 ? newItems[0].createdAt.getTime() : Date.now();
  const cursor = new Date(newestTs + 1).toISOString();

  return NextResponse.json({ unreadCount, newItems, cursor });
}
