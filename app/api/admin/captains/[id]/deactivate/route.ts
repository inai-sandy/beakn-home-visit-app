import { eq } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, sessions, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';

// HVA-91: POST /api/admin/captains/[id]/deactivate
//
// DESIGN DECISION (documented in deploy summary):
//   Deactivation atomically:
//     1. Unassigns this captain's cities (cities.captain_user_id → NULL)
//     2. Sets users.is_active = false
//     3. Revokes all sessions
//   Admin then re-assigns the orphan cities to another active captain via
//   that captain's Edit modal. No destination-picker in this modal —
//   avoids 3+ cities violation of the "exactly 2" creation rule and
//   keeps the deactivation flow single-purpose.
//
//   Orphan cities sit with captain_user_id = NULL until admin re-assigns.
//   Anonymous customer submissions to those cities still work (HVA-33
//   accepts any seeded city); captain-side dashboards just hide cities
//   without a captain owner.

const paramsSchema = z.object({ id: z.string().uuid() });
interface Ctx { params: Promise<{ id: string }> }

export async function POST(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }
  const userId = params.data.id;

  const [target] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target || target.role !== USER_ROLES.CAPTAIN) {
    return NextResponse.json({ ok: false, error: 'Captain not found' }, { status: 404 });
  }
  if (!target.isActive) {
    return NextResponse.json({ ok: false, error: 'Already inactive' }, { status: 409 });
  }

  const beforeCities = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.captainUserId, userId));

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(cities)
        .set({ captainUserId: null })
        .where(eq(cities.captainUserId, userId));
      await tx
        .update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'captain_deactivated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: {
      fullName: target.fullName,
      citiesUnassigned: beforeCities.map((c) => c.name),
      sessionsRevoked: true,
    },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return NextResponse.json(
    { ok: true, citiesUnassigned: beforeCities.map((c) => c.name) },
    { status: 200 },
  );
}
