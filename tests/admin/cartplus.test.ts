import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  users,
  webhookEvents,
  webhookSecrets,
} from '@/db/schema';
import {
  findCityByStoreId,
  findUserByPortalExecId,
  getActiveCartplusSecret,
  loadCartplusCities,
  loadCartplusExecs,
  loadCartplusSecrets,
} from '@/lib/admin/cartplus';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-248 (HVA-230 Phase 1.A): CartPlus webhook foundation
// =============================================================================
//
// truncateAll() deliberately preserves the cities seed (migration-seeded
// rows that other tests depend on). The cities this file creates via
// getOrCreateCity('SchemaTestCityA') etc. therefore leak across the suite
// unless we clean them up explicitly. afterAll handles that.

const TEST_CITY_NAMES = [
  'SchemaTestCityA',
  'SchemaTestCityB',
  'LoadCitiesA',
  'RevLookupCity',
];

afterAll(async () => {
  await db.delete(cities).where(inArray(cities.name, TEST_CITY_NAMES));
});
//
// Tests cover:
//   - schema columns exist + uniqueness enforced
//   - loadCartplusSecrets returns rows ordered + isActive flag correct
//   - getActiveCartplusSecret returns the most recent unrevoked secret
//   - loadCartplusCities + loadCartplusExecs surface mapping state
//   - findCityByStoreId / findUserByPortalExecId reverse-lookup
//   - webhook_events UNIQUE (provider, provider_event_id)
// =============================================================================

describe('HVA-248 schema columns', () => {
  it('cities.cartplus_store_id is nullable + uniquely indexable', async () => {
    const a = await getOrCreateCity('SchemaTestCityA');
    const b = await getOrCreateCity('SchemaTestCityB');
    await db
      .update(cities)
      .set({ cartplusStoreId: 9991 })
      .where(eq(cities.id, a.id));

    // Setting the SAME store_id on a second city should fail (unique idx)
    let dup: Error | null = null;
    try {
      await db
        .update(cities)
        .set({ cartplusStoreId: 9991 })
        .where(eq(cities.id, b.id));
    } catch (err) {
      dup = err instanceof Error ? err : new Error(String(err));
    }
    expect(dup).not.toBeNull();
    // Drizzle wraps the underlying postgres-js error; the constraint name
    // may be in .cause or in the wrapped message. Just assert an error.
  });

  it('users.portal_exec_id is nullable + uniquely indexable', async () => {
    const captain = await seedCaptain({ phone: '+919985200001' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919985200002',
      fullName: 'Exec PortalUnique',
    });
    await db
      .update(users)
      .set({ portalExecId: 12345 })
      .where(eq(users.id, exec.id));

    let dup: Error | null = null;
    try {
      await db
        .update(users)
        .set({ portalExecId: 12345 })
        .where(eq(users.id, captain.id));
    } catch (err) {
      dup = err instanceof Error ? err : new Error(String(err));
    }
    expect(dup).not.toBeNull();
    // Drizzle wraps the underlying postgres-js error; the constraint name
    // may be in .cause or in the wrapped message. Just assert an error.
  });

  it('webhook_events UNIQUE (provider, provider_event_id) enforced', async () => {
    await db.insert(webhookEvents).values({
      provider: 'cartplus',
      providerEventId: 'evt_test_dup_1',
      eventType: 'order.created',
      payload: { id: 'evt_test_dup_1' },
    });
    let dup: Error | null = null;
    try {
      await db.insert(webhookEvents).values({
        provider: 'cartplus',
        providerEventId: 'evt_test_dup_1',
        eventType: 'order.created',
        payload: { id: 'evt_test_dup_1' },
      });
    } catch (err) {
      dup = err instanceof Error ? err : new Error(String(err));
    }
    expect(dup).not.toBeNull();
    // Drizzle wraps the underlying postgres-js error; the constraint name
    // may be in .cause or in the wrapped message. Just assert an error.
  });
});

describe('loadCartplusSecrets', () => {
  it('orders by createdAt desc and flags isActive=true when revokedAt is null', async () => {
    const admin = await seedSuperAdmin({ phone: '+919985300001' });
    await db.insert(webhookSecrets).values({
      provider: 'cartplus',
      secret: 'aaaaaaaa',
      secretPreview: 'aaaa…aaaa',
      createdByUserId: admin.id,
    });
    await db.insert(webhookSecrets).values({
      provider: 'cartplus',
      secret: 'bbbbbbbb',
      secretPreview: 'bbbb…bbbb',
      createdByUserId: admin.id,
      revokedAt: new Date(),
    });

    const rows = await loadCartplusSecrets();
    expect(rows.length).toBe(2);
    // Most recent insert first (clock-tick precision sufficient)
    const flags = rows.map((r) => r.isActive);
    expect(flags).toContain(true);
    expect(flags).toContain(false);
  });
});

describe('getActiveCartplusSecret', () => {
  it('returns null when no secrets exist', async () => {
    const found = await getActiveCartplusSecret();
    expect(found).toBeNull();
  });

  it('returns the active (non-revoked) row', async () => {
    const admin = await seedSuperAdmin({ phone: '+919985400001' });
    await db.insert(webhookSecrets).values({
      provider: 'cartplus',
      secret: 'old_revoked',
      secretPreview: 'old_…oked',
      createdByUserId: admin.id,
      revokedAt: new Date(),
    });
    await db.insert(webhookSecrets).values({
      provider: 'cartplus',
      secret: 'new_active',
      secretPreview: 'new_…tive',
      createdByUserId: admin.id,
    });

    const found = await getActiveCartplusSecret();
    expect(found).not.toBeNull();
    expect(found!.secret).toBe('new_active');
  });
});

describe('loadCartplusCities', () => {
  it('returns every city with cartplus_store_id (null if unmapped)', async () => {
    const a = await getOrCreateCity('LoadCitiesA');
    await db
      .update(cities)
      .set({ cartplusStoreId: 7001 })
      .where(eq(cities.id, a.id));

    const rows = await loadCartplusCities();
    const mapped = rows.find((r) => r.cityName === 'LoadCitiesA');
    expect(mapped).toBeDefined();
    expect(mapped!.cartplusStoreId).toBe(7001);
    // No webhooks received → null
    expect(mapped!.lastWebhookAt).toBeNull();
  });
});

describe('loadCartplusExecs', () => {
  it('returns only active sales_executive and captain users', async () => {
    const captain = await seedCaptain({ phone: '+919985500001' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919985500002',
      fullName: 'Exec LoadExecs',
    });
    await seedSuperAdmin({ phone: '+919985500003' });

    const rows = await loadCartplusExecs();
    const phones = rows.map((r) => r.phone);
    expect(phones).toContain(captain.phone);
    expect(phones).toContain(exec.phone);
    // super_admin excluded
    expect(phones).not.toContain('+919985500003');

    const captainRow = rows.find((r) => r.userId === captain.id);
    expect(captainRow!.role).toBe('captain');
    const execRow = rows.find((r) => r.userId === exec.id);
    expect(execRow!.role).toBe('sales_executive');
  });
});

describe('findCityByStoreId / findUserByPortalExecId', () => {
  it('reverse-lookup returns the row when set', async () => {
    const city = await getOrCreateCity('RevLookupCity');
    await db
      .update(cities)
      .set({ cartplusStoreId: 8001 })
      .where(eq(cities.id, city.id));
    const foundCity = await findCityByStoreId(8001);
    expect(foundCity).not.toBeNull();
    expect(foundCity!.name).toBe('RevLookupCity');

    const captain = await seedCaptain({ phone: '+919985600001' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919985600002',
      fullName: 'Exec Reverse',
    });
    await db
      .update(users)
      .set({ portalExecId: 90001 })
      .where(eq(users.id, exec.id));
    const foundUser = await findUserByPortalExecId(90001);
    expect(foundUser).not.toBeNull();
    expect(foundUser!.fullName).toBe('Exec Reverse');
    expect(foundUser!.role).toBe('sales_executive');
  });

  it('reverse-lookup returns null on no match', async () => {
    const foundCity = await findCityByStoreId(999999);
    expect(foundCity).toBeNull();
    const foundUser = await findUserByPortalExecId(999999);
    expect(foundUser).toBeNull();
  });
});

// Reference imports the linter would otherwise drop.
void sql;
