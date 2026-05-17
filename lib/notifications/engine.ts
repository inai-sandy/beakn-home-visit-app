import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { notificationRules, users } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';

import { sendViaDiscord } from './channels/discord';
import { sendViaEmail } from './channels/email';
import { sendViaInApp, type AdapterArgs, type AdapterResult } from './channels/in-app';
import { sendViaWhatsApp } from './channels/whatsapp';

// =============================================================================
// HVA-48: notification rules engine — dispatchNotification(event, context)
// =============================================================================
//
// Reads enabled `notification_rules` for the event, resolves each rule's
// recipient_role + channel to a concrete target, invokes the channel
// adapter, and records a single audit row capturing the dispatch result.
//
// CONTRACT:
//   * Single async function. Returns DispatchResult, never throws.
//   * Adapter failures are caught and recorded as `status: 'failed'` in
//     the per-delivery breakdown — never bubble.
//   * Audit row is written outside the per-rule loop so a single dispatch
//     produces one audit entry, regardless of N deliveries.
//   * Synchronous, in-process. Single-worker stack (HVA-112 finding) —
//     no LISTEN/NOTIFY, no out-of-band queue.
//
// CALL PATTERN — fire and forget:
//   The engine's caller (e.g. /api/requests/[id]/assign) wraps the
//   dispatchNotification call in `setImmediate(() => dispatch.catch(log))`
//   so the HTTP response returns before deliveries start.
// =============================================================================

const engineLog = log.child({ component: 'notifications.engine' });

export type Channel = 'in_app' | 'email' | 'whatsapp' | 'discord';
export type RecipientRole =
  | 'exec_assigned'
  | 'exec_removed'
  | 'captain_assigning'
  | 'captain_acting'
  | 'captain_owning_city'
  | 'customer'
  | 'super_admin';

export interface Delivery {
  channel: string;
  recipientRole: string;
  /** user_id, phone, or email — whatever the channel needed. Null when skipped before resolution. */
  resolvedTarget: string | null;
  status: 'delivered' | 'skipped' | 'failed';
  error?: string;
  externalId?: string;
}

export interface DispatchResult {
  eventType: string;
  rulesMatched: number;
  deliveries: Delivery[];
  /** Audit row id, or null when audit write failed (audit never throws). */
  auditRowId: string | null;
}

interface ResolvedRecipient {
  userId: string | null;
  /** Direct address for the 'customer' role (phone or email) — bypasses users-table lookup. */
  directAddress: string | null;
  /** Optional human-readable reason when resolution returned null. */
  reason?: string;
}

interface RuleRow {
  channel: string;
  recipientRole: string;
  templateKey: string | null;
}

// =============================================================================
// Recipient resolution: rule → (user_id | direct_address)
// =============================================================================
//
// `recipientRole` maps onto context fields per the HVA-48 brief:
//   exec_assigned         → context.execUserId
//   exec_removed          → context.oldExecUserId  (HVA-140 — the exec being taken off)
//   captain_assigning     → context.captainUserId  (actor who clicked Assign)
//   captain_acting        → context.captainUserId  (HVA-140 — actor who clicked Reassign)
//   captain_owning_city   → context.cityCaptainUserId
//   customer              → context.customerPhone (WA) | context.customerEmail
//   super_admin           → all users where role='super_admin' AND is_active
//                           (fan-out — returns multiple resolved recipients)
//
// Returns an array so super_admin fans out naturally; single-recipient
// roles return a 1-element array.

async function resolveRecipients(
  role: string,
  channel: string,
  context: Record<string, unknown>,
): Promise<ResolvedRecipient[]> {
  switch (role) {
    case 'exec_assigned': {
      const userId = context.execUserId;
      if (typeof userId !== 'string' || userId.length === 0) {
        return [{ userId: null, directAddress: null, reason: 'execUserId missing from context' }];
      }
      return [{ userId, directAddress: null }];
    }
    case 'captain_assigning': {
      const userId = context.captainUserId;
      if (typeof userId !== 'string' || userId.length === 0) {
        return [
          { userId: null, directAddress: null, reason: 'captainUserId missing from context' },
        ];
      }
      return [{ userId, directAddress: null }];
    }
    case 'captain_acting': {
      // HVA-140: confirmation channel for the captain who just clicked
      // Reassign. Same context field as captain_assigning — distinct
      // role name keeps the rule's semantics legible.
      const userId = context.captainUserId;
      if (typeof userId !== 'string' || userId.length === 0) {
        return [
          { userId: null, directAddress: null, reason: 'captainUserId missing from context' },
        ];
      }
      return [{ userId, directAddress: null }];
    }
    case 'exec_removed': {
      // HVA-140: in-app drawer for the previous exec when a captain
      // reassigns the request to someone else.
      const userId = context.oldExecUserId;
      if (typeof userId !== 'string' || userId.length === 0) {
        return [
          { userId: null, directAddress: null, reason: 'oldExecUserId missing from context' },
        ];
      }
      return [{ userId, directAddress: null }];
    }
    case 'captain_owning_city': {
      const userId = context.cityCaptainUserId;
      if (typeof userId !== 'string' || userId.length === 0) {
        return [
          {
            userId: null,
            directAddress: null,
            reason: 'cityCaptainUserId missing from context',
          },
        ];
      }
      return [{ userId, directAddress: null }];
    }
    case 'customer': {
      // Channels with no in-app surface for non-users.
      if (channel === 'in_app') {
        return [
          {
            userId: null,
            directAddress: null,
            reason: 'invalid combo: in_app channel + customer role',
          },
        ];
      }
      if (channel === 'whatsapp') {
        const phone = context.customerPhone;
        if (typeof phone !== 'string' || phone.length === 0) {
          return [
            { userId: null, directAddress: null, reason: 'customerPhone missing' },
          ];
        }
        return [{ userId: null, directAddress: phone }];
      }
      if (channel === 'email') {
        const email = context.customerEmail;
        if (typeof email !== 'string' || email.length === 0) {
          return [
            { userId: null, directAddress: null, reason: 'customerEmail missing' },
          ];
        }
        return [{ userId: null, directAddress: email }];
      }
      return [
        {
          userId: null,
          directAddress: null,
          reason: `unsupported channel for customer role: ${channel}`,
        },
      ];
    }
    case 'super_admin': {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true)));
      if (rows.length === 0) {
        return [{ userId: null, directAddress: null, reason: 'no active super_admin users' }];
      }
      return rows.map((r) => ({ userId: r.id, directAddress: null }));
    }
    default:
      return [
        {
          userId: null,
          directAddress: null,
          reason: `unknown recipient_role: ${role}`,
        },
      ];
  }
}

// =============================================================================
// User-id → channel-specific address resolution
// =============================================================================

async function userTargetForChannel(
  userId: string,
  channel: string,
): Promise<{ ok: true; target: string } | { ok: false; reason: string }> {
  if (channel === 'in_app') {
    // In-app target IS the user_id.
    return { ok: true, target: userId };
  }
  const [row] = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) {
    return { ok: false, reason: `user ${userId} not found` };
  }
  if (channel === 'email') {
    if (!row.email || row.email.length === 0) {
      return { ok: false, reason: `user ${userId} has no email` };
    }
    return { ok: true, target: row.email };
  }
  if (channel === 'whatsapp') {
    if (!row.phone || row.phone.length === 0) {
      return { ok: false, reason: `user ${userId} has no phone` };
    }
    return { ok: true, target: row.phone };
  }
  if (channel === 'discord') {
    // Discord routes to channel webhooks, not user-specific addresses.
    // The stub adapter doesn't actually use the target; we hand it the
    // user_id as a placeholder for log breadcrumbs. HVA-43 will revisit.
    return { ok: true, target: userId };
  }
  return { ok: false, reason: `unknown channel: ${channel}` };
}

// =============================================================================
// Channel adapter dispatch
// =============================================================================

async function invokeChannel(
  channel: string,
  args: AdapterArgs,
): Promise<AdapterResult> {
  try {
    switch (channel) {
      case 'in_app':
        return await sendViaInApp(args);
      case 'email':
        return await sendViaEmail(args);
      case 'whatsapp':
        return await sendViaWhatsApp(args);
      case 'discord':
        return await sendViaDiscord(args);
      default:
        return { status: 'failed', error: `unknown_channel:${channel}` };
    }
  } catch (err) {
    // Last-resort guard. Channel adapters are expected to swallow their
    // own failures, but if one ever throws, the engine still completes
    // its remaining deliveries and records this one as failed.
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'adapter_threw',
    };
  }
}

// =============================================================================
// Public API
// =============================================================================

export async function dispatchNotification(
  eventType: string,
  context: Record<string, unknown>,
): Promise<DispatchResult> {
  let rules: RuleRow[] = [];
  try {
    rules = await db
      .select({
        channel: notificationRules.channel,
        recipientRole: notificationRules.recipientRole,
        templateKey: notificationRules.templateKey,
      })
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.eventType, eventType),
          eq(notificationRules.enabled, true),
        ),
      );
  } catch (err) {
    engineLog.error(
      { eventType, err: err instanceof Error ? err.message : String(err) },
      'notification_rules_lookup_failed',
    );
    return {
      eventType,
      rulesMatched: 0,
      deliveries: [],
      auditRowId: null,
    };
  }

  const deliveries: Delivery[] = [];

  for (const rule of rules) {
    const recipients = await resolveRecipients(
      rule.recipientRole,
      rule.channel,
      context,
    );

    for (const recipient of recipients) {
      // Skip path: recipient resolution returned null (no user id, no
      // direct address) — record the reason and move on.
      if (recipient.userId === null && recipient.directAddress === null) {
        deliveries.push({
          channel: rule.channel,
          recipientRole: rule.recipientRole,
          resolvedTarget: null,
          status: 'skipped',
          error: recipient.reason ?? 'recipient_not_resolved',
        });
        continue;
      }

      // Address resolution: user_id → channel-specific address (in_app
      // keeps the user_id as-is).
      let target: string;
      if (recipient.directAddress !== null) {
        target = recipient.directAddress;
      } else {
        const addr = await userTargetForChannel(
          recipient.userId as string,
          rule.channel,
        );
        if (!addr.ok) {
          deliveries.push({
            channel: rule.channel,
            recipientRole: rule.recipientRole,
            resolvedTarget: null,
            status: 'skipped',
            error: addr.reason,
          });
          continue;
        }
        target = addr.target;
      }

      // HVA-140: composers for events with multiple recipient_role rules
      // on the same channel (in_app: exec_removed + exec_assigned) need
      // to know WHICH role they're rendering for. Inject the current
      // rule's recipientRole into the context for the composer to read.
      // No-op for events with a single rule per channel.
      const adapterResult = await invokeChannel(rule.channel, {
        target,
        eventType,
        context: { ...context, recipientRole: rule.recipientRole },
        templateKey: rule.templateKey,
      });

      deliveries.push({
        channel: rule.channel,
        recipientRole: rule.recipientRole,
        resolvedTarget: target,
        status: adapterResult.status === 'delivered' ? 'delivered' : 'failed',
        error: adapterResult.error,
        externalId: adapterResult.externalId,
      });
    }
  }

  // Audit row. logEvent is fire-and-forget (HVA-18 contract); the
  // engine treats the audit write as advisory.
  const targetEntityId =
    typeof context.requestId === 'string' ? context.requestId : null;
  await logEvent({
    eventType: 'notification_dispatched',
    actorUserId: null,
    targetEntityType: 'notification_event',
    targetEntityId,
    afterState: {
      event: eventType,
      rulesMatched: rules.length,
      deliveries,
    },
  });

  engineLog.info(
    {
      event: eventType,
      rulesMatched: rules.length,
      delivered: deliveries.filter((d) => d.status === 'delivered').length,
      failed: deliveries.filter((d) => d.status === 'failed').length,
      skipped: deliveries.filter((d) => d.status === 'skipped').length,
    },
    'notification_dispatched',
  );

  return {
    eventType,
    rulesMatched: rules.length,
    deliveries,
    // We don't currently capture the audit row's id back from logEvent
    // (it has no return value by design). Future: refactor logEvent to
    // return the row id when needed; for now, null.
    auditRowId: null,
  };
}
