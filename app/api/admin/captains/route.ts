import { hashPassword } from 'better-auth/crypto';
import { eq, inArray, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import {
  accounts,
  captains,
  cities,
  users,
} from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { captainCreateSchema } from '@/lib/validators/admin-users';

// =============================================================================
// HVA-91: POST /api/admin/captains — create a captain user + assign 2 cities
// =============================================================================
//
// AUTH: super_admin only.
//
// VALIDATION (every step gates the next):
//   1. Zod payload — name/phone/email/cityIds[2]
//   2. Phone uniqueness across users
//   3. Email uniqueness across users
//   4. Both city ids exist
//   5. Neither city is already assigned to an ACTIVE captain (cities with
//      captain_user_id pointing at an inactive captain count as
//      reassignable — that captain's deactivation should have unassigned
//      them, but be defensive)
//
// EXECUTION (single tx):
//   a. INSERT users (role='captain', must_change_password=true)
//   b. INSERT accounts row with scrypt-hashed temp password
//   c. INSERT captains subtype row (user_id PK, is_unavailable default false)
//   d. UPDATE cities SET captain_user_id = newUserId WHERE id IN (cityIds)
//   e. audit_log: 'captain_created'
//
// Response: { ok, user, tempPassword } — temp password shown ONCE to admin.
// =============================================================================

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = captainCreateSchema.safeParse(bodyRaw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      { ok: false, error: 'Some fields are invalid.', fieldErrors },
      { status: 400 },
    );
  }
  const { fullName, phone, email, cityIds } = parsed.data;
  const phoneStorage = `+91${phone}`;

  // Pre-flight uniqueness. Email is optional — only query it when set, so
  // we don't get spurious "email taken" matches against other null rows.
  const uniqWhere = email
    ? or(eq(users.phone, phoneStorage), eq(users.email, email))
    : eq(users.phone, phoneStorage);
  const conflicts = await db
    .select({ id: users.id, phone: users.phone, email: users.email })
    .from(users)
    .where(uniqWhere);
  if (conflicts.length > 0) {
    const phoneTaken = conflicts.some((c) => c.phone === phoneStorage);
    const emailTaken = email
      ? conflicts.some((c) => c.email === email)
      : false;
    return NextResponse.json(
      {
        ok: false,
        error: phoneTaken && emailTaken
          ? 'Both phone and email already in use.'
          : phoneTaken
            ? 'Phone number already in use.'
            : 'Email already in use.',
        fieldErrors: {
          ...(phoneTaken && { phone: 'Already in use' }),
          ...(emailTaken && { email: 'Already in use' }),
        },
      },
      { status: 409 },
    );
  }

  const cityRows = await db
    .select({
      id: cities.id,
      name: cities.name,
      captainUserId: cities.captainUserId,
    })
    .from(cities)
    .where(inArray(cities.id, cityIds));
  // B1 2026-05-26 fix: lifted from cityRows.length !== 2 to compare against
  // the input length so 1-or-2 cities are both valid per the lifted
  // captainCreateSchema. Without this, the validator accepts 1 city but
  // the route still hard-rejects.
  if (cityRows.length !== cityIds.length) {
    return NextResponse.json(
      { ok: false, error: 'One or more cities not found.' },
      { status: 400 },
    );
  }

  // For each city already assigned, check if the holder is active.
  const heldByIds = cityRows
    .map((c) => c.captainUserId)
    .filter((id): id is string => id !== null);
  if (heldByIds.length > 0) {
    const holders = await db
      .select({ id: users.id, isActive: users.isActive, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, heldByIds));
    const stillActive = holders.some((h) => h.isActive);
    if (stillActive) {
      const conflictCities = cityRows
        .filter((c) => {
          const h = holders.find((u) => u.id === c.captainUserId);
          return h?.isActive;
        })
        .map((c) => c.name);
      return NextResponse.json(
        {
          ok: false,
          error: `City already assigned to an active captain: ${conflictCities.join(', ')}.`,
          fieldErrors: { cityIds: 'Some cities are taken' },
        },
        { status: 409 },
      );
    }
  }

  // Generate + hash temp password.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  let createdId: string;
  try {
    createdId = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          role: USER_ROLES.CAPTAIN,
          fullName,
          phone: phoneStorage,
          email: email ?? null,
          phoneVerified: false,
          isActive: true,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      await tx.insert(accounts).values({
        accountId: u.id,
        providerId: 'credential',
        userId: u.id,
        password: passwordHash,
      });
      await tx.insert(captains).values({ userId: u.id });
      await tx
        .update(cities)
        .set({ captainUserId: u.id })
        .where(inArray(cities.id, cityIds));
      return u.id;
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : 'Service temporarily unavailable.',
      },
      { status: 503 },
    );
  }

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'captain_created',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: createdId,
    afterState: {
      role: USER_ROLES.CAPTAIN,
      fullName,
      phone: phoneStorage,
      email: email ?? null,
      cityIds,
      cityNames: cityRows.map((c) => c.name),
    },
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-143: invalidate the client Router Cache so admin pages
  // (e.g. /admin/captains) reflect the new captain on next navigation.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      user: {
        id: createdId,
        fullName,
        phone: phoneStorage,
        email: email ?? null,
        cityIds,
      },
      tempPassword,
    },
    { status: 200 },
  );
}

