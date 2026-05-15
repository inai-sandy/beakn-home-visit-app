import { eq } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';

// HVA-91: POST /api/admin/captains/[id]/activate
// Toggle is_active back to true. No special validation — admin re-
// assigning cities to this captain happens through Edit. Sessions stay
// wiped from the prior deactivate; user re-logs in fresh.

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
  if (!target || target.role !== 'captain') {
    return NextResponse.json({ ok: false, error: 'Captain not found' }, { status: 404 });
  }
  if (target.isActive) {
    return NextResponse.json({ ok: false, error: 'Already active' }, { status: 409 });
  }

  await db
    .update(users)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'captain_activated',
    actorUserId: actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: { fullName: target.fullName, isActive: true },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
