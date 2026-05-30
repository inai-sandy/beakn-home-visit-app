// 2026-05-30: per-user notification preference queries + actions backing
// /profile/notifications.
//
// Default model: notification_rules defines what events a role is eligible
// for; absence of a notification_preferences row → use the rule's default.
// A row with enabled=false → user has opted out. The settings page toggles
// upsert here.

'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { notificationPreferences, notificationRules } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import type { Role } from '@/lib/auth/roles';

// Map app role → which notification_rules.recipient_role values can target
// this user. Mirrors lib/notifications/engine.ts:resolveRecipients.
const ROLE_TO_RECIPIENT_ROLES: Record<Role, readonly string[]> = {
  sales_executive: ['exec_assigned', 'exec_removed'],
  captain: ['captain_owning_city', 'captain_assigning', 'captain_acting'],
  super_admin: ['super_admin'],
};

export type PreferenceChannel = 'in_app' | 'push' | 'email';

export interface UserNotificationPreferenceRow {
  eventType: string;
  channel: PreferenceChannel;
  /** Whether this rule is on for the user. Reflects default + override. */
  enabled: boolean;
}

/**
 * Load every (event_type, channel) tuple the user is eligible for given
 * their role, then merge in any per-user overrides. Returns ONE row per
 * unique (event_type, channel) — if multiple recipient_roles point to this
 * user for the same event, they collapse here.
 */
export async function loadUserNotificationPreferences(
  userId: string,
  role: Role,
): Promise<UserNotificationPreferenceRow[]> {
  const recipientRoles = ROLE_TO_RECIPIENT_ROLES[role];
  if (recipientRoles.length === 0) return [];

  const ruleRows = await db
    .select({
      eventType: notificationRules.eventType,
      channel: notificationRules.channel,
      enabled: notificationRules.enabled,
    })
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.enabled, true),
        inArray(
          notificationRules.recipientRole,
          recipientRoles as unknown as string[],
        ),
      ),
    );

  const prefRows = await db
    .select({
      eventType: notificationPreferences.eventType,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  // Collapse rules to unique (event, channel). If any rule says enabled,
  // the default is enabled. Then layer the per-user pref on top.
  const seen = new Map<string, UserNotificationPreferenceRow>();
  for (const r of ruleRows) {
    const key = `${r.eventType}|${r.channel}`;
    if (!seen.has(key)) {
      seen.set(key, {
        eventType: r.eventType,
        channel: r.channel as PreferenceChannel,
        enabled: true,
      });
    }
  }
  for (const p of prefRows) {
    const key = `${p.eventType}|${p.channel}`;
    const existing = seen.get(key);
    if (!existing) continue;
    existing.enabled = p.enabled;
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.eventType !== b.eventType) return a.eventType.localeCompare(b.eventType);
    return a.channel.localeCompare(b.channel);
  });
}

export type PreferenceActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Upsert one preference row. Always caller-scoped — userId comes from the
 * server session, never the request body.
 */
export async function setNotificationPreferenceAction(args: {
  eventType: string;
  channel: PreferenceChannel;
  enabled: boolean;
}): Promise<PreferenceActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  if (typeof args.eventType !== 'string' || args.eventType.length === 0) {
    return { ok: false, error: 'bad_event_type' };
  }
  if (args.channel !== 'in_app' && args.channel !== 'push' && args.channel !== 'email') {
    return { ok: false, error: 'bad_channel' };
  }

  await db
    .insert(notificationPreferences)
    .values({
      userId: session.user.id,
      eventType: args.eventType,
      channel: args.channel,
      enabled: args.enabled,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.eventType,
        notificationPreferences.channel,
      ],
      set: {
        enabled: args.enabled,
        updatedAt: sql`NOW()`,
      },
    });

  revalidatePath('/profile/notifications');
  return { ok: true };
}
