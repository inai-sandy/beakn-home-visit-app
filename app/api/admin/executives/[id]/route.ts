import { and, eq, ne, or } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { executiveEditSchema } from '@/lib/validators/admin-users';

// HVA-92: PATCH /api/admin/executives/[id] — edit executive
//
// Updates users (name/phone/email) and the sales_executives row's
// captain_user_id when the assignment changes. New captain must exist
// + be active. Phone/email uniqueness excludes self.

const paramsSchema = z.object({ id: z.string().uuid() });
interface Ctx { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }
  const execId = params.data.id;

  const [existing] = await db
    .select({
      id: users.id,
      role: users.role,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      captainUserId: salesExecutives.captainUserId,
    })
    .from(users)
    .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
    .where(eq(users.id, execId))
    .limit(1);
  if (!existing || existing.role !== USER_ROLES.SALES_EXECUTIVE) {
    return NextResponse.json({ ok: false, error: 'Executive not found' }, { status: 404 });
  }

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = executiveEditSchema.safeParse(bodyRaw);
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
  const { fullName, phone, email, captainUserId } = parsed.data;
  const phoneStorage = `+91${phone}`;

  const uniqMatch = email
    ? or(eq(users.phone, phoneStorage), eq(users.email, email))
    : eq(users.phone, phoneStorage);
  const conflicts = await db
    .select({ id: users.id, phone: users.phone, email: users.email })
    .from(users)
    .where(and(ne(users.id, execId), uniqMatch));
  if (conflicts.length > 0) {
    const phoneTaken = conflicts.some((c) => c.phone === phoneStorage);
    const emailTaken = email ? conflicts.some((c) => c.email === email) : false;
    return NextResponse.json(
      {
        ok: false,
        error: phoneTaken ? 'Phone number already in use.' : 'Email already in use.',
        fieldErrors: {
          ...(phoneTaken && { phone: 'Already in use' }),
          ...(emailTaken && { email: 'Already in use' }),
        },
      },
      { status: 409 },
    );
  }

  const [cap] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, captainUserId))
    .limit(1);
  if (!cap || cap.role !== USER_ROLES.CAPTAIN) {
    return NextResponse.json(
      { ok: false, error: 'Captain not found.', fieldErrors: { captainUserId: 'Invalid captain' } },
      { status: 400 },
    );
  }
  if (!cap.isActive) {
    return NextResponse.json(
      { ok: false, error: 'Captain is inactive.', fieldErrors: { captainUserId: 'Captain inactive' } },
      { status: 400 },
    );
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ fullName, phone: phoneStorage, email: email ?? null, updatedAt: new Date() })
        .where(eq(users.id, execId));
      await tx
        .update(salesExecutives)
        .set({ captainUserId, updatedAt: new Date() })
        .where(eq(salesExecutives.userId, execId));
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'executive_updated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: execId,
    beforeState: {
      fullName: existing.fullName,
      phone: existing.phone,
      email: existing.email,
      captainUserId: existing.captainUserId,
    },
    afterState: { fullName, phone: phoneStorage, email: email ?? null, captainUserId },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
