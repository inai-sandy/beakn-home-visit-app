import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities } from '@/db/schema';
import { loadProfileForUser } from '@/lib/profile/queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// HVA-76: profile loader scopes.

describe('loadProfileForUser', () => {
  beforeEach(async () => {
    // Clean any prior captain-city assignments from the shared cities table
    // so each test starts with no captain owning any city.
    await db.update(cities).set({ captainUserId: null });
  });

  it('returns null for an unknown user id', async () => {
    const profile = await loadProfileForUser({
      userId: '00000000-0000-7000-8000-000000000000',
      role: 'sales_executive',
    });
    expect(profile).toBeNull();
  });

  it('exec scope joins through their captain to the captain\'s cities', async () => {
    const captain = await seedCaptain({
      phone: '+919000076101',
      fullName: 'Captain Lakshmi',
    });
    const cityA = await getOrCreateCity('Bangalore');
    const cityB = await getOrCreateCity('Hyderabad');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, cityA.id));
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, cityB.id));

    const exec = await seedExecutive(captain.id, {
      phone: '+919100076101',
      fullName: 'Exec Ravi',
    });

    const profile = await loadProfileForUser({
      userId: exec.id,
      role: 'sales_executive',
    });

    expect(profile).not.toBeNull();
    expect(profile!.fullName).toBe('Exec Ravi');
    expect(profile!.role).toBe('sales_executive');
    expect(profile!.scope.type).toBe('exec');
    if (profile!.scope.type !== 'exec') throw new Error('unreachable');
    expect(profile!.scope.captainName).toBe('Captain Lakshmi');
    expect(profile!.scope.cities.map((c) => c.name).sort()).toEqual([
      'Bangalore',
      'Hyderabad',
    ]);
  });

  it('exec with a captain who owns no cities returns an empty cities array', async () => {
    const captain = await seedCaptain({ phone: '+919000076102' });
    const exec = await seedExecutive(captain.id, { phone: '+919100076102' });

    const profile = await loadProfileForUser({
      userId: exec.id,
      role: 'sales_executive',
    });

    expect(profile!.scope.type).toBe('exec');
    if (profile!.scope.type !== 'exec') throw new Error('unreachable');
    expect(profile!.scope.cities).toEqual([]);
    expect(profile!.scope.captainName).toBeTruthy();
  });

  it('captain scope returns only the cities they own', async () => {
    const captain = await seedCaptain({
      phone: '+919000076103',
      fullName: 'Captain Priya',
    });
    const otherCaptain = await seedCaptain({
      phone: '+919000076104',
      fullName: 'Captain Other',
    });

    const cityA = await getOrCreateCity('Chennai');
    const cityB = await getOrCreateCity('Pune');
    const cityC = await getOrCreateCity('Mumbai');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(sql`${cities.id} IN (${cityA.id}, ${cityB.id})`);
    await db
      .update(cities)
      .set({ captainUserId: otherCaptain.id })
      .where(eq(cities.id, cityC.id));

    const profile = await loadProfileForUser({
      userId: captain.id,
      role: 'captain',
    });

    expect(profile!.role).toBe('captain');
    expect(profile!.scope.type).toBe('captain');
    if (profile!.scope.type !== 'captain') throw new Error('unreachable');
    expect(profile!.scope.cities.map((c) => c.name).sort()).toEqual([
      'Chennai',
      'Pune',
    ]);
  });

  it('super_admin scope renders as Global with no cities lookup', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888076101' });

    const profile = await loadProfileForUser({
      userId: admin.id,
      role: 'super_admin',
    });

    expect(profile!.role).toBe('super_admin');
    expect(profile!.scope).toEqual({ type: 'super_admin' });
  });
});
