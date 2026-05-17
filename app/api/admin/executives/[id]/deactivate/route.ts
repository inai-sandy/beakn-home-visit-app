import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { sessions, statusStages, users, visitRequests } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';

// HVA-92: POST /api/admin/executives/[id]/deactivate
//
// Pre-check: refuse if the exec has OPEN assigned requests
// (assigned_exec_user_id = exec AND status_stage_id != terminal).
// Returns 409 with the count + a hint to reassign or close them first.
//
// On success (single tx):
//   - is_active = false
//   - revoke all sessions
//   - keep the sales_executives row intact (preserves captain link for
//     historical attribution)
//   - audit: 'executive_deactivated'

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
  if (!target || target.role !== USER_ROLES.SALES_EXECUTIVE) {
    return NextResponse.json({ ok: false, error: 'Executive not found' }, { status: 404 });
  }
  if (!target.isActive) {
    return NextResponse.json({ ok: false, error: 'Already inactive' }, { status: 409 });
  }

  // Open-request check. Terminal stage = the highest-sequence active stage,
  // matching HVA-67's dynamic-MAX definition (so admin-added stages extend
  // the lifecycle without code changes here either).
  const [terminal] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);

  const [{ openCount }] = await db
    .select({ openCount: sql<number>`count(*)::int` })
    .from(visitRequests)
    .where(
      terminal
        ? and(
            eq(visitRequests.assignedExecUserId, userId),
            ne(visitRequests.statusStageId, terminal.id),
          )
        : eq(visitRequests.assignedExecUserId, userId),
    );

  if (openCount > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Executive has ${openCount} open ${openCount === 1 ? 'request' : 'requests'}. Reassign or close them before deactivating.`,
        openRequestCount: openCount,
      },
      { status: 409 },
    );
  }

  try {
    await db.transaction(async (tx) => {
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
    eventType: 'executive_deactivated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: { fullName: target.fullName, isActive: false, sessionsRevoked: true },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-143: client Router Cache invalidation for cross-page nav.
  revalidatePath('/', 'layout');

  return NextResponse.json({ ok: true }, { status: 200 });
}
