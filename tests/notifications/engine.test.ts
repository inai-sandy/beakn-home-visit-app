import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, inAppNotifications, notificationRules } from '@/db/schema';

// Mock lib/email so engine tests don't try to hit SMTP for the email channel.
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (input: { to: string }) => {
    if (input.to === 'broken@example.com') {
      return { ok: false, error: 'simulated_smtp_failure' };
    }
    return { ok: true, messageId: `<msg-engine-${Date.now()}@test>` };
  }),
}));

import { dispatchNotification } from '@/lib/notifications/engine';

import { seedCaptain, seedExecutive } from '../helpers/db';

// Tests in this file insert into notification_rules. The harness's
// truncateAll() now wipes notification_rules between tests; the seed
// migration repopulates the 2 default rows on next test setup-cycle
// via setup/global.ts? No — global setup applies migrations once at
// container boot. truncate wipes everything. So between tests we must
// restore the default rules OR insert fresh ones per test.
//
// Approach: each test inserts ONLY the rules it needs. afterEach
// truncates everything (handled by per-file.ts via truncateAll).

const REQ_ID = '019e0000-0000-0000-0000-00000000aaaa';

async function insertRule(opts: {
  channel: 'in_app' | 'email' | 'whatsapp' | 'discord';
  recipientRole: string;
  eventType?: string;
  enabled?: boolean;
}) {
  await db.insert(notificationRules).values({
    eventType: opts.eventType ?? 'request.assigned',
    channel: opts.channel,
    recipientRole: opts.recipientRole,
    enabled: opts.enabled ?? true,
  });
}

describe('dispatchNotification', () => {
  it('two rules fan out → both deliveries succeed; one audit row written', async () => {
    const cap = await seedCaptain({ email: 'captain@example.com' });
    const exec = await seedExecutive(cap.id);

    await insertRule({ channel: 'in_app', recipientRole: 'exec_assigned' });
    await insertRule({ channel: 'email', recipientRole: 'captain_assigning' });

    const result = await dispatchNotification('request.assigned', {
      requestId: REQ_ID,
      execUserId: exec.id,
      execName: 'Veera',
      captainUserId: cap.id,
      captainName: 'Arjun',
      customerName: 'Aarav',
      cityName: 'Bangalore',
    });

    expect(result.eventType).toBe('request.assigned');
    expect(result.rulesMatched).toBe(2);
    expect(result.deliveries).toHaveLength(2);
    const statuses = result.deliveries.map((d) => d.status);
    expect(statuses).toEqual(['delivered', 'delivered']);

    // In-app row landed
    const [inApp] = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, exec.id));
    expect(inApp.eventType).toBe('request.assigned');
    expect(inApp.title).toContain('Aarav');

    // Audit row for the dispatch itself
    const audits = await db
      .select({ eventType: auditLog.eventType, afterState: auditLog.afterState })
      .from(auditLog)
      .where(eq(auditLog.eventType, 'notification_dispatched'));
    expect(audits.length).toBe(1);
    const after = audits[0].afterState as { event: string; rulesMatched: number };
    expect(after.event).toBe('request.assigned');
    expect(after.rulesMatched).toBe(2);
  });

  it('zero matching rules → rulesMatched=0, deliveries empty, never throws', async () => {
    const result = await dispatchNotification('event.with.no.rules', {});
    expect(result.rulesMatched).toBe(0);
    expect(result.deliveries).toHaveLength(0);
  });

  it('invalid combo (in_app + customer) → skipped with reason', async () => {
    await insertRule({ channel: 'in_app', recipientRole: 'customer' });
    const result = await dispatchNotification('request.assigned', {
      customerEmail: 'someone@example.com',
    });
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].status).toBe('skipped');
    expect(result.deliveries[0].error).toMatch(/in_app.*customer/u);
  });

  it('recipient resolution null (missing context field) → skipped', async () => {
    await insertRule({ channel: 'in_app', recipientRole: 'exec_assigned' });
    // No execUserId in context
    const result = await dispatchNotification('request.assigned', {
      requestId: REQ_ID,
    });
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].status).toBe('skipped');
    expect(result.deliveries[0].error).toMatch(/execUserId missing/u);
  });

  it('adapter failure path (broken email) → status=failed; engine still completes', async () => {
    const cap = await seedCaptain({ email: 'broken@example.com' });
    const exec = await seedExecutive(cap.id);
    await insertRule({ channel: 'email', recipientRole: 'captain_assigning' });
    await insertRule({ channel: 'in_app', recipientRole: 'exec_assigned' });

    const result = await dispatchNotification('request.assigned', {
      requestId: REQ_ID,
      execUserId: exec.id,
      execName: 'Veera',
      captainUserId: cap.id,
      captainName: 'Arjun',
      customerName: 'Aarav',
      cityName: 'Bangalore',
    });

    const byChannel = Object.fromEntries(
      result.deliveries.map((d) => [d.channel, d.status]),
    );
    expect(byChannel.email).toBe('failed');
    expect(byChannel.in_app).toBe('delivered');
  });

  it('rules with enabled=false are ignored', async () => {
    const cap = await seedCaptain({ email: 'captain@example.com' });
    const exec = await seedExecutive(cap.id);
    await insertRule({
      channel: 'in_app',
      recipientRole: 'exec_assigned',
      enabled: false,
    });

    const result = await dispatchNotification('request.assigned', {
      requestId: REQ_ID,
      execUserId: exec.id,
      execName: 'Veera',
      captainUserId: cap.id,
      captainName: 'Arjun',
      customerName: 'Aarav',
      cityName: 'Bangalore',
    });
    expect(result.rulesMatched).toBe(0);
    expect(result.deliveries).toHaveLength(0);
  });
});

// =============================================================================
// Notification-wiring fix regression tests
// =============================================================================
//
// Covers three events whose notification_rules were enabled (either from a
// prior migration or from 0080, which ships in the same PR as these code
// fixes) but whose dispatch either had no registered in-app composer
// (installation_scheduled / approval_overdue — 'failed' delivery) or whose
// caller didn't pass the context key the recipient resolver reads
// (approval_overdue's cityCaptainUserId — 'skipped' delivery pre-fix, before
// migration 0080 even seeded the rule at all).
// =============================================================================
describe('dispatchNotification — notification-wiring fixes', () => {
  it('request.approval_overdue delivers in-app to the owning city captain', async () => {
    const cap = await seedCaptain({ phone: '+919911100001' });
    await insertRule({
      channel: 'in_app',
      recipientRole: 'captain_owning_city',
      eventType: 'request.approval_overdue',
    });

    const result = await dispatchNotification('request.approval_overdue', {
      requestId: REQ_ID,
      customerName: 'Rahul Verma',
      cityName: 'Pune',
      cityCaptainUserId: cap.id,
      hoursStuck: 30,
    });

    expect(result.rulesMatched).toBeGreaterThanOrEqual(1);
    expect(result.deliveries).toHaveLength(1);
    // Pre-fix: IN_APP_COMPOSERS had no 'request.approval_overdue' entry, so
    // the in-app adapter returned status='failed', error='no_in_app_composer_
    // for_request.approval_overdue'. The composer is now registered
    // (lib/notifications/compose/request-approval-overdue.ts) so this
    // resolves to 'delivered'.
    expect(result.deliveries[0].status).toBe('delivered');
    expect(result.deliveries[0].error).toBeUndefined();

    const [inApp] = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, cap.id));
    expect(inApp).toBeDefined();
    expect(inApp.title.length).toBeGreaterThan(0);
    expect(inApp.title).toContain('Rahul Verma');
  });

  it('request.installation_scheduled delivers in-app to both the assigned exec and the owning city captain', async () => {
    const cap = await seedCaptain({ phone: '+919911100002' });
    const exec = await seedExecutive(cap.id, { phone: '+919911100003' });
    await insertRule({
      channel: 'in_app',
      recipientRole: 'exec_assigned',
      eventType: 'request.installation_scheduled',
    });
    await insertRule({
      channel: 'in_app',
      recipientRole: 'captain_owning_city',
      eventType: 'request.installation_scheduled',
    });

    const result = await dispatchNotification('request.installation_scheduled', {
      requestId: REQ_ID,
      execUserId: exec.id,
      cityCaptainUserId: cap.id,
      customerName: 'Meera Nair',
      cityName: 'Chennai',
    });

    expect(result.rulesMatched).toBe(2);
    expect(result.deliveries).toHaveLength(2);
    // Pre-fix: no composer registered for this event → both deliveries
    // would have come back 'failed' (no_in_app_composer_for_request
    // .installation_scheduled).
    const statuses = result.deliveries.map((d) => d.status);
    expect(statuses).toEqual(['delivered', 'delivered']);

    const rows = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.eventType, 'request.installation_scheduled'));
    expect(rows).toHaveLength(2);
    const recipientIds = rows.map((r) => r.userId).sort();
    expect(recipientIds).toEqual([cap.id, exec.id].sort());
  });

  it('request.reassigned resolves exec_removed/exec_assigned/captain_acting when the caller passes oldExecUserId + execUserId + captainUserId', async () => {
    const cap = await seedCaptain({
      phone: '+919911100004',
      email: 'captain-reassign@example.com',
    });
    const fromExec = await seedExecutive(cap.id, { phone: '+919911100005' });
    const toExec = await seedExecutive(cap.id, { phone: '+919911100006' });

    // Mirror the 3 rules migration 0017 seeds for request.reassigned.
    await insertRule({
      channel: 'in_app',
      recipientRole: 'exec_removed',
      eventType: 'request.reassigned',
    });
    await insertRule({
      channel: 'in_app',
      recipientRole: 'exec_assigned',
      eventType: 'request.reassigned',
    });
    await insertRule({
      channel: 'email',
      recipientRole: 'captain_acting',
      eventType: 'request.reassigned',
    });

    // This is the SHAPE bulkReassignAffectedVisitsAction now dispatches
    // (oldExecUserId / execUserId / captainUserId) — pre-fix the action only
    // passed fromExecUserId/toExecUserId/reason, none of which any resolver
    // reads, so every one of these 3 deliveries would have come back
    // 'skipped' with a "missing from context" reason.
    const result = await dispatchNotification('request.reassigned', {
      requestId: REQ_ID,
      customerName: 'Divya Rao',
      cityName: 'Hyderabad',
      oldExecUserId: fromExec.id,
      oldExecName: 'From Exec',
      execUserId: toExec.id,
      newExecName: 'To Exec',
      captainUserId: cap.id,
      captainName: 'Test Captain',
      reason: 'Rebalanced because the exec went on unplanned leave today.',
    });

    expect(result.rulesMatched).toBe(3);
    const byRole = Object.fromEntries(
      result.deliveries.map((d) => [d.recipientRole, d]),
    );
    expect(byRole.exec_removed.status).toBe('delivered');
    expect(byRole.exec_removed.resolvedTarget).toBe(fromExec.id);
    expect(byRole.exec_assigned.status).toBe('delivered');
    expect(byRole.exec_assigned.resolvedTarget).toBe(toExec.id);
    expect(byRole.captain_acting.status).toBe('delivered');

    const rows = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.eventType, 'request.reassigned'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.body).not.toContain('undefined');
      expect(row.body.length).toBeGreaterThan(0);
    }
  });
});
