import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { auditLog, config } from '@/db/schema';
import { getConfig, setConfig } from '@/lib/config';

import { seedSuperAdmin } from '../helpers/db';

// =============================================================================
// HVA-112: lib/config — no-cache reads + actor-attributed audit
// =============================================================================
//
// truncateAll() preserves the config table (rows are admin-tuned + seed
// values). The tests below mutate `day_plan_cutoff_time` (a value with
// safe enum-free string validation) — the afterEach deletes that row +
// any audit rows we added so the suite stays isolated.
// =============================================================================

const KEY = 'day_plan_cutoff_time';

afterEach(async () => {
  await db.delete(config).where(eq(config.key, KEY));
  await db
    .delete(auditLog)
    .where(eq(auditLog.targetEntityId, KEY));
});

describe('getConfig — no cache (HVA-112)', () => {
  it('returns the persisted value after an external write — no stale cached value', async () => {
    await db.insert(config).values({
      key: KEY,
      category: 'workflow',
      description: 'test row',
      value: '09:00',
    });
    const first = await getConfig(KEY);
    expect(first).toBe('09:00');

    // Simulate an out-of-band write (different worker / direct SQL).
    // Pre-HVA-112 this would have been hidden by the in-process Map for
    // up to 60s. With the cache removed, the next read sees it.
    await db
      .update(config)
      .set({ value: '11:30', updatedAt: new Date() })
      .where(eq(config.key, KEY));

    const second = await getConfig(KEY);
    expect(second).toBe('11:30');
  });

  it('falls back to CONFIG_SCHEMA defaultValue when row is missing', async () => {
    // ensure no row
    await db.delete(config).where(eq(config.key, KEY));
    const v = await getConfig(KEY);
    // CONFIG_SCHEMA.day_plan_cutoff_time.defaultValue is '09:30'.
    expect(v).toBe('09:30');
  });

  it('falls back to default when the stored value fails validation', async () => {
    await db.insert(config).values({
      key: KEY,
      category: 'workflow',
      description: 'test row',
      // pattern is HH:MM 24h — 'not-a-time' violates the regex
      value: 'not-a-time',
    });
    const v = await getConfig(KEY);
    expect(v).toBe('09:30');
  });
});

describe('setConfig — actor-attributed audit (HVA-112)', () => {
  it('writes audit row with actor when caller passes one', async () => {
    // FK: audit_log.actor_user_id references users.id, so the actor must
    // be a real seeded super_admin.
    const admin = await seedSuperAdmin();
    await setConfig(KEY, '10:00', {
      userId: admin.id,
      role: 'super_admin',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
    });

    expect(await getConfig(KEY)).toBe('10:00');

    const [row] = await db
      .select({
        eventType: auditLog.eventType,
        actorUserId: auditLog.actorUserId,
        actorRole: auditLog.actorRole,
        targetEntityId: auditLog.targetEntityId,
        beforeState: auditLog.beforeState,
        afterState: auditLog.afterState,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, KEY))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    expect(row.eventType).toBe('configuration_change');
    expect(row.actorUserId).toBe(admin.id);
    expect(row.actorRole).toBe('super_admin');
    expect(row.afterState).toEqual({ value: '10:00' });
    expect(row.ipAddress).toBe('10.0.0.1');
    expect(row.userAgent).toBe('vitest');
  });

  it('writes audit row with actor_user_id=null when actor is omitted (internal callers)', async () => {
    await setConfig(KEY, '07:45');

    const [row] = await db
      .select({
        actorUserId: auditLog.actorUserId,
        actorRole: auditLog.actorRole,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, KEY))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    expect(row.actorUserId).toBeNull();
    expect(row.actorRole).toBeNull();
    expect(row.afterState).toEqual({ value: '07:45' });
  });

  it('throws on a value that fails CONFIG_SCHEMA validation', async () => {
    await expect(setConfig(KEY, 'not-a-time')).rejects.toThrow(
      /value does not satisfy/u,
    );
  });
});
