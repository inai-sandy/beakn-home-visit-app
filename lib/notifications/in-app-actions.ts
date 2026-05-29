'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { inAppNotifications } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';

// HVA-52: server actions for the in-app notification drawer.
//
// Both mutations are caller-scoped: the WHERE clause includes
// `user_id = me` so a malicious payload can never mark someone else's
// notification as read. Drizzle's update returns affected rows so we can
// also surface a no-op silently if the id doesn't belong to the caller.

export type InAppActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function markNotificationReadAction(
  notificationId: string,
): Promise<InAppActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  if (
    typeof notificationId !== 'string' ||
    notificationId.length === 0
  ) {
    return { ok: false, error: 'bad_input' };
  }
  await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.id, notificationId),
        eq(inAppNotifications.userId, session.user.id),
        isNull(inAppNotifications.readAt),
      ),
    );
  // Update the bell badge across the layout tree on next render.
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<InAppActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  await db
    .update(inAppNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(inAppNotifications.userId, session.user.id),
        isNull(inAppNotifications.readAt),
      ),
    );
  revalidatePath('/', 'layout');
  return { ok: true };
}
