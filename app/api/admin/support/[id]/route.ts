import { and, eq, ne, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { supportUserEditSchema } from '@/lib/validators/admin-users';

// =============================================================================
// HVA-236: PATCH /api/admin/support/[id] — edit name / phone / email
// =============================================================================

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
  const userId = params.data.id;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = supportUserEditSchema.safeParse(bodyRaw);
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
  const { fullName, phone, email } = parsed.data;
  const phoneStorage = `+91${phone}`;

  const [existing] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName, phone: users.phone, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
  }
  if (existing.role !== USER_ROLES.SUPPORT) {
    return NextResponse.json(
      { ok: false, error: 'Not a support user' },
      { status: 400 },
    );
  }

  // Uniqueness: skip the row itself.
  const uniqMatch = email
    ? or(eq(users.phone, phoneStorage), eq(users.email, email))
    : eq(users.phone, phoneStorage);
  const conflicts = await db
    .select({ id: users.id, phone: users.phone, email: users.email })
    .from(users)
    .where(and(uniqMatch, ne(users.id, userId)));
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

  await db
    .update(users)
    .set({
      fullName,
      phone: phoneStorage,
      email: email ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'support_user_updated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: userId,
    beforeState: {
      fullName: existing.fullName,
      phone: existing.phone,
      email: existing.email,
    },
    afterState: { fullName, phone: phoneStorage, email: email ?? null },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true });
}
