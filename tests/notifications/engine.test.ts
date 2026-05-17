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
