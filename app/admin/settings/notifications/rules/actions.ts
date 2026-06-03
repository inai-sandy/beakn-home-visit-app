'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { notificationRules } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { logEvent } from '@/lib/audit';

// =============================================================================
// HVA-50: notification rules admin editor — server actions
// =============================================================================
//
// Admin can toggle each rule's `enabled` flag. Body composition still
// lives in code (lib/notifications/compose/*) for now — template_key is
// admin-editable as a future hook but doesn't drive composition yet.
// =============================================================================

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const toggleSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});

export async function toggleRuleAction(
  input: z.infer<typeof toggleSchema>,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') return { ok: false, error: 'Forbidden' };

  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const before = await db
    .select({
      id: notificationRules.id,
      eventType: notificationRules.eventType,
      channel: notificationRules.channel,
      recipientRole: notificationRules.recipientRole,
      enabled: notificationRules.enabled,
    })
    .from(notificationRules)
    .where(eq(notificationRules.id, parsed.data.id))
    .limit(1);

  if (before.length === 0) return { ok: false, error: 'Rule not found' };

  await db
    .update(notificationRules)
    .set({ enabled: parsed.data.enabled, updatedAt: new Date() })
    .where(eq(notificationRules.id, parsed.data.id));

  await logEvent({
    eventType: 'notification_rule_toggled',
    actorUserId: user.id,
    targetEntityType: 'notification_rule',
    targetEntityId: parsed.data.id,
    beforeState: { enabled: before[0]!.enabled },
    afterState: {
      enabled: parsed.data.enabled,
      eventType: before[0]!.eventType,
      channel: before[0]!.channel,
      recipientRole: before[0]!.recipientRole,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
