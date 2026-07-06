import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { inAppNotifications, notificationRules, visitRequests } from '@/db/schema';
import { bulkReassignAffectedVisitsAction } from '@/lib/captain/rebalance-actions';

import { loginByPhone } from '../helpers/auth';
import { getOrCreateCity, seedCaptain, seedExecutive, seedVisitRequest } from '../helpers/db';

// =============================================================================
// Notification-wiring fix: bulkReassignAffectedVisitsAction → request.reassigned
// =============================================================================
//
// Pre-fix, the action dispatched `request.reassigned` with only
// `fromExecUserId` / `toExecUserId` / `reason` in context. None of the three
// notification_rules recipient resolvers for this event read those keys
// (exec_removed reads oldExecUserId, exec_assigned reads execUserId,
// captain_acting reads captainUserId) — every delivery came back 'skipped'
// with a "missing from context" reason, so neither the outgoing nor the
// incoming exec (nor the acting captain) ever saw a notification for a
// rebalance reassignment.
//
// The fix (see lib/captain/rebalance-actions.ts) enriches the dispatch
// context with oldExecUserId/execUserId/captainUserId plus resolved
// customer/city/exec/captain names. These tests exercise the ACTION itself
// (not just the engine) so a regression in the action's context-building
// would be caught even if the engine's resolvers are untouched.
// =============================================================================

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

// Mock lib/email so the captain_acting email rule doesn't try real SMTP —
// SMTP_* env vars aren't set in the test container.
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => ({ ok: true, messageId: '<msg-rebalance-test@test>' })),
}));

beforeEach(() => {
  currentCookieHeader = undefined;
});

async function seedReassignedRules(): Promise<void> {
  // Mirrors migration 0017's 3 rows for request.reassigned.
  await db.insert(notificationRules).values([
    {
      eventType: 'request.reassigned',
      channel: 'in_app',
      recipientRole: 'exec_removed',
      enabled: true,
    },
    {
      eventType: 'request.reassigned',
      channel: 'in_app',
      recipientRole: 'exec_assigned',
      enabled: true,
    },
    {
      eventType: 'request.reassigned',
      channel: 'email',
      recipientRole: 'captain_acting',
      enabled: true,
    },
  ]);
}

async function seedFutureScheduledVisit(opts: {
  cityId: string;
  execUserId: string;
}): Promise<string> {
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execUserId,
    statusStageCode: 'INSTALLATION_SCHEDULED',
  });
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await db
    .update(visitRequests)
    .set({ visitScheduledAt: future, customerName: 'Divya Rao' })
    .where(eq(visitRequests.id, req.id));
  return req.id;
}

describe('bulkReassignAffectedVisitsAction — request.reassigned notifications', () => {
  it('delivers in-app to the outgoing exec (exec_removed) and incoming exec (exec_assigned), and email to the acting captain (captain_acting)', async () => {
    const cap = await seedCaptain({
      phone: '+919922200001',
      email: 'captain-rebalance@example.com',
      fullName: 'Rebalance Captain',
    });
    const fromExec = await seedExecutive(cap.id, {
      phone: '+919922200002',
      fullName: 'Outgoing Exec',
    });
    const toExec = await seedExecutive(cap.id, {
      phone: '+919922200003',
      fullName: 'Incoming Exec',
    });
    const city = await getOrCreateCity('Hyderabad');
    const requestId = await seedFutureScheduledVisit({
      cityId: city.id,
      execUserId: fromExec.id,
    });
    await seedReassignedRules();

    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await bulkReassignAffectedVisitsAction({
      fromExecUserId: fromExec.id,
      reassignments: [{ requestId, toExecUserId: toExec.id }],
      reason: 'Outgoing exec is on unplanned leave for the rest of the week.',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data?.reassignedCount).toBe(1);

    // The DB reassignment itself happened.
    const [updated] = await db
      .select({ assignedExecUserId: visitRequests.assignedExecUserId })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));
    expect(updated!.assignedExecUserId).toBe(toExec.id);

    // exec_removed → fromExec, exec_assigned → toExec. Pre-fix: both would
    // have been 'skipped' (oldExecUserId/execUserId missing from context),
    // so NO in_app_notifications rows would exist for either exec.
    const rows = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.eventType, 'request.reassigned'));
    expect(rows).toHaveLength(2);

    const forFromExec = rows.find((r) => r.userId === fromExec.id);
    const forToExec = rows.find((r) => r.userId === toExec.id);
    expect(forFromExec).toBeDefined();
    expect(forToExec).toBeDefined();

    // Names resolved (not the literal string "undefined") and non-empty.
    for (const row of [forFromExec!, forToExec!]) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.body.length).toBeGreaterThan(0);
      expect(row.title).not.toContain('undefined');
      expect(row.body).not.toContain('undefined');
      // Customer name should have been resolved from the visit_requests row
      // via the action's reqInfoById lookup, not the "a customer" fallback —
      // both composers render it into the title.
      expect(row.title).toContain('Divya Rao');
    }
    // The "to" exec's name flows into the removed exec's body, and the
    // "from" exec's name flows into the assigned exec's body — proves
    // newExecName/oldExecName were both resolved from real users, not
    // left as the 'a team member' fallback.
    expect(forFromExec!.body).toContain('Incoming Exec');
    expect(forToExec!.body).toContain('Outgoing Exec');
  });

  it('gracefully no-ops notifications (never blocks the reassignment) when notification_rules has no rows for request.reassigned', async () => {
    // No seedReassignedRules() call — rulesMatched=0 inside the engine.
    const cap = await seedCaptain({
      phone: '+919922200004',
      fullName: 'Captain NoRules',
    });
    const fromExec = await seedExecutive(cap.id, { phone: '+919922200005' });
    const toExec = await seedExecutive(cap.id, { phone: '+919922200006' });
    const city = await getOrCreateCity('Hyderabad');
    const requestId = await seedFutureScheduledVisit({
      cityId: city.id,
      execUserId: fromExec.id,
    });

    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await bulkReassignAffectedVisitsAction({
      fromExecUserId: fromExec.id,
      reassignments: [{ requestId, toExecUserId: toExec.id }],
      reason: 'No active rules seeded — the reassignment must still succeed.',
    });

    expect(res.ok).toBe(true);
    const rows = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.eventType, 'request.reassigned'));
    expect(rows).toHaveLength(0);
  });
});
