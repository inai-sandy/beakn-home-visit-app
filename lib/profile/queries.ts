import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities, salesExecutives, users } from '@/db/schema';
import type { Role } from '@/lib/auth/roles';

// HVA-76: Profile page loader. One call returns the fields rendered by the
// Account Info card plus the role-specific scope footer (exec → captain
// name + the captain's cities; captain → cities they own).

export interface CityRef {
  id: string;
  name: string;
}

export type ProfileScope =
  | { type: 'exec'; captainName: string | null; cities: CityRef[] }
  | { type: 'captain'; cities: CityRef[] }
  | { type: 'super_admin' };

export interface ProfileData {
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  scope: ProfileScope;
}

export async function loadProfileForUser(args: {
  userId: string;
  role: Role;
}): Promise<ProfileData | null> {
  const [userRow] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);

  if (!userRow) return null;

  let scope: ProfileScope;
  if (args.role === 'sales_executive') {
    const [execRow] = await db
      .select({ captainUserId: salesExecutives.captainUserId })
      .from(salesExecutives)
      .where(eq(salesExecutives.userId, args.userId))
      .limit(1);

    let captainName: string | null = null;
    let cityRows: CityRef[] = [];
    if (execRow) {
      const [captainUser] = await db
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, execRow.captainUserId))
        .limit(1);
      captainName = captainUser?.fullName ?? null;

      cityRows = await db
        .select({ id: cities.id, name: cities.name })
        .from(cities)
        .where(eq(cities.captainUserId, execRow.captainUserId))
        .orderBy(asc(cities.name));
    }

    scope = { type: 'exec', captainName, cities: cityRows };
  } else if (args.role === 'captain') {
    const cityRows = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(eq(cities.captainUserId, args.userId))
      .orderBy(asc(cities.name));
    scope = { type: 'captain', cities: cityRows };
  } else {
    scope = { type: 'super_admin' };
  }

  return {
    userId: userRow.id,
    fullName: userRow.fullName,
    phone: userRow.phone,
    email: userRow.email,
    role: userRow.role,
    scope,
  };
}
