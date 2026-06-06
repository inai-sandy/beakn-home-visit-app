import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';

// =============================================================================
// HVA-236: POST /api/admin/support/[id]/deactivate
// =============================================================================
//
// Mirrors executive deactivate. Single tx:
//   - users.is_active = false
//   - revoke all sessions
//   - audit_log: 'support_user_deactivated'
//
// No pre-check on assigned work — support doesn't own visit_requests
// (the dispatch tables don't have a notion of "assigned support user",
// dispatches are global). Future: if dispatch ownership becomes a
// thing, gate this on open dispatches.

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
    .select({ id: users.id, role: users.role, isActive: users.isActive, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
  }
  if (existing.role !== USER_ROLES.SUPPORT) {
    return NextResponse.json({ ok: false, error: 'Not a support user' }, { status: 400 });
  }
  if (!existing.isActive) {
    return NextResponse.json({ ok: false, error: 'Already deactivated' }, { status: 409 });
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'support_user_deactivated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: userId,
    beforeState: { isActive: true, fullName: existing.fullName },
    afterState: { isActive: false },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true });
}
