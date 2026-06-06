import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { accounts, sessions, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';

// HVA-236: POST /api/admin/support/[id]/reset-password — mirrors executive reset.

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

  const [existing] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
  }
  if (existing.role !== USER_ROLES.SUPPORT) {
    return NextResponse.json({ ok: false, error: 'Not a support user' }, { status: 400 });
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(accounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(accounts.userId, userId));
    await tx
      .update(users)
      .set({ mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'support_user_password_reset',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: { fullName: existing.fullName, mustChangePassword: true },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true, tempPassword });
}
