import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { accounts, sessions, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { logEvent } from '@/lib/audit';

// HVA-92: POST /api/admin/executives/[id]/reset-password — same pattern as
// captain reset-password (HVA-91); only difference is the role gate.

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
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target || target.role !== 'sales_executive') {
    return NextResponse.json({ ok: false, error: 'Executive not found' }, { status: 404 });
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
      await tx
        .update(users)
        .set({ mustChangePassword: true, updatedAt: new Date() })
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
    eventType: 'executive_password_reset',
    actorUserId: actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: { fullName: target.fullName, mustChangePassword: true, sessionsRevoked: true },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return NextResponse.json({ ok: true, tempPassword }, { status: 200 });
}
