import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, payments, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { paymentVoidSchema } from '@/lib/validators/payment';

// =============================================================================
// HVA-70: POST /api/requests/[id]/payments/[paymentId]/void
// =============================================================================
//
// Marks a payment row as voided. Voided rows are kept (audit trail) but
// excluded from totals. Captain-of-city or super_admin only — the
// assigned exec CANNOT void. Voiding requires a reason ≥ 10 chars.
//
// Idempotency: voiding an already-voided row returns 409.
// =============================================================================

const ALLOWED_ROLES = [USER_ROLES.CAPTAIN, USER_ROLES.SUPER_ADMIN] as const;

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  paymentId: z.string().uuid('paymentId must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string; paymentId: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/payments/[paymentId]/void' });

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const reqHeaders = await headersFn();
  const correlationId = reqHeaders.get('x-request-id') ?? undefined;
  const reqLog = apiLog.child({ correlationId });

  // 1. Auth + role gate. ALLOWED_ROLES excludes sales_executive.
  let session;
  try {
    session = await requireAuth(ALLOWED_ROLES);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    throw err;
  }
  const actorUserId = session.user.id;
  const actorRole = (session.user as { role?: string }).role as Role;
  const isAdmin = actorRole === USER_ROLES.SUPER_ADMIN;

  // 2. Validate path.
  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      { ok: false, error: paramsParsed.error.issues[0]?.message ?? 'Invalid params' },
      { status: 400 },
    );
  }
  const { id: requestUuid, paymentId } = paramsParsed.data;

  // 3. Validate body.
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const bodyParsed = paymentVoidSchema.safeParse(bodyRaw);
  if (!bodyParsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of bodyParsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      { ok: false, error: 'Some fields are invalid.', fieldErrors },
      { status: 400 },
    );
  }
  const { reason } = bodyParsed.data;

  // 4. Load request + city captain + payment row.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      cityCaptainUserId: cities.captainUserId,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }

  const [paymentRow] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.visitRequestId, requestUuid)))
    .limit(1);

  if (!paymentRow) {
    return NextResponse.json(
      { ok: false, error: 'Payment not found on this request' },
      { status: 404 },
    );
  }

  // 5. Per-request authorization (captain-of-city or admin).
  if (!isAdmin) {
    const allowed =
      actorRole === USER_ROLES.CAPTAIN &&
      reqRow.cityCaptainUserId === actorUserId;
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: 'This request is not in your assigned city.' },
        { status: 403 },
      );
    }
  }

  // 6. Already-voided guard.
  if (paymentRow.voidedAt !== null) {
    return NextResponse.json(
      { ok: false, error: 'Payment is already voided.' },
      { status: 409 },
    );
  }

  // 7. Void.
  const now = new Date();
  let updated: typeof payments.$inferSelect;
  try {
    const [row] = await db
      .update(payments)
      .set({
        voidedAt: now,
        voidedByUserId: actorUserId,
        voidedReason: reason,
        updatedAt: now,
      })
      .where(eq(payments.id, paymentId))
      .returning();
    updated = row!;
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'payment_void_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 8. Audit.
  await logEvent({
    eventType: 'payment_voided',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: {
      paymentId: paymentRow.id,
      direction: paymentRow.direction,
      amountPaise: paymentRow.amountPaise,
      voidedAt: null,
    },
    afterState: {
      paymentId: updated.id,
      direction: updated.direction,
      amountPaise: updated.amountPaise,
      voidedAt: now.toISOString(),
      voidedReason: reason,
    },
    reason,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-143: client Router Cache invalidation for sibling pages.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      payment: {
        id: updated.id,
        voidedAt: updated.voidedAt,
        voidedByUserId: updated.voidedByUserId,
        voidedReason: updated.voidedReason,
      },
    },
    { status: 200 },
  );
}
