import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { inAppNotifications } from '@/db/schema';
import { sendViaInApp } from '@/lib/notifications/channels/in-app';

import { seedCaptain } from '../../helpers/db';

describe('sendViaInApp', () => {
  it('inserts a row + returns delivered with externalId', async () => {
    const cap = await seedCaptain();
    const result = await sendViaInApp({
      target: cap.id,
      eventType: 'request.assigned',
      context: {
        requestId: '019e0000-0000-0000-0000-000000000001',
        customerName: 'Test Customer',
        cityName: 'Bangalore',
        execUserId: cap.id,
        execName: 'Veera',
        captainUserId: cap.id,
        captainName: 'Arjun',
        note: null,
      },
      templateKey: null,
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBeDefined();

    const [row] = await db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.id, result.externalId as string));
    expect(row.userId).toBe(cap.id);
    expect(row.eventType).toBe('request.assigned');
    expect(row.title).toBe('New request assigned: Test Customer');
    expect(row.linkUrl).toBe('/requests/019e0000-0000-0000-0000-000000000001');
  });

  it('returns failed without throwing when no composer is registered', async () => {
    const cap = await seedCaptain();
    const result = await sendViaInApp({
      target: cap.id,
      eventType: 'unknown.event.type',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no_in_app_composer_for_unknown\.event\.type/u);
  });

  it('returns failed without throwing when target is not a real user', async () => {
    const result = await sendViaInApp({
      target: '019e0000-0000-0000-0000-000000999999',
      eventType: 'request.assigned',
      context: {
        requestId: '019e0000-0000-0000-0000-000000000001',
        customerName: 'X',
        cityName: 'X',
        execUserId: '019e0000-0000-0000-0000-000000000002',
        execName: 'X',
        captainUserId: '019e0000-0000-0000-0000-000000000003',
        captainName: 'X',
      },
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });
});
