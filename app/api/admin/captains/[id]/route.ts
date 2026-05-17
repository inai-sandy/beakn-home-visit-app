import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { captainEditSchema } from '@/lib/validators/admin-users';

// =============================================================================
// HVA-91: PATCH /api/admin/captains/[id] — edit captain
// =============================================================================
//
// Validates phone/email uniqueness EXCLUDING self. Enforces city assignment
// rules (cities not taken by another active captain).
//
// In a single tx:
//   - UPDATE users SET fullName/phone/email
//   - Unassign any cities currently held by this captain but not in the
//     new cityIds (cities.captain_user_id → NULL)
//   - Assign new cities (cities.captain_user_id → this captain)
//   - audit_log: 'captain_updated' with before/after
// =============================================================================

const paramsSchema = z.object({ id: z.string().uuid() });

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }
  const captainId = params.data.id;

  // Load existing captain
  const [existing] = await db
    .select({
      id: users.id,
      role: users.role,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, captainId))
    .limit(1);
  if (!existing || existing.role !== USER_ROLES.CAPTAIN) {
    return NextResponse.json({ ok: false, error: 'Captain not found' }, { status: 404 });
  }

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = captainEditSchema.safeParse(bodyRaw);
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

  // Uniqueness — exclude self. Email optional.
  const uniqMatch = email
    ? or(eq(users.phone, phoneStorage), eq(users.email, email))
    : eq(users.phone, phoneStorage);
  const conflicts = await db
    .select({ id: users.id, phone: users.phone, email: users.email })
    .from(users)
    .where(and(ne(users.id, captainId), uniqMatch));
  if (conflicts.length > 0) {
    const phoneTaken = conflicts.some((c) => c.phone === phoneStorage);
    const emailTaken = email ? conflicts.some((c) => c.email === email) : false;
    return NextResponse.json(
      {
        ok: false,
        error: phoneTaken
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

  // Validate cityIds: must exist + must not be held by another ACTIVE
  // captain (held by THIS captain is fine — no-op transfer).
  if (cityIds.length > 0) {
    const cityRows = await db
      .select({ id: cities.id, name: cities.name, captainUserId: cities.captainUserId })
      .from(cities)
      .where(inArray(cities.id, cityIds));
    if (cityRows.length !== cityIds.length) {
      return NextResponse.json(
        { ok: false, error: 'One or more cities not found.', fieldErrors: { cityIds: 'Invalid city' } },
        { status: 400 },
      );
    }
    const otherHolderIds = cityRows
      .filter((c) => c.captainUserId && c.captainUserId !== captainId)
      .map((c) => c.captainUserId as string);
    if (otherHolderIds.length > 0) {
      const holders = await db
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(inArray(users.id, otherHolderIds));
      if (holders.some((h) => h.isActive)) {
        const taken = cityRows
          .filter((c) => holders.find((h) => h.id === c.captainUserId && h.isActive))
          .map((c) => c.name);
        return NextResponse.json(
          {
            ok: false,
            error: `City already assigned to an active captain: ${taken.join(', ')}.`,
            fieldErrors: { cityIds: 'Some cities are taken' },
          },
          { status: 409 },
        );
      }
    }
  }

  // Capture before-state for audit.
  const beforeCityIds = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.captainUserId, captainId));

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ fullName, phone: phoneStorage, email: email ?? null, updatedAt: new Date() })
        .where(eq(users.id, captainId));

      // Unassign cities previously held by this captain that aren't in
      // the new list.
      const newSet = new Set(cityIds);
      const toRelease = beforeCityIds
        .filter((c) => !newSet.has(c.id))
        .map((c) => c.id);
      if (toRelease.length > 0) {
        await tx
          .update(cities)
          .set({ captainUserId: null })
          .where(inArray(cities.id, toRelease));
      }
      // Assign new (or re-assign existing).
      if (cityIds.length > 0) {
        await tx
          .update(cities)
          .set({ captainUserId: captainId })
          .where(inArray(cities.id, cityIds));
      }
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'captain_updated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: captainId,
    beforeState: {
      fullName: existing.fullName,
      phone: existing.phone,
      email: existing.email,
      cityIds: beforeCityIds.map((c) => c.id),
      cityNames: beforeCityIds.map((c) => c.name),
    },
    afterState: { fullName, phone: phoneStorage, email: email ?? null, cityIds },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-143: client Router Cache invalidation for cross-page nav.
  revalidatePath('/', 'layout');

  return NextResponse.json({ ok: true }, { status: 200 });
}
