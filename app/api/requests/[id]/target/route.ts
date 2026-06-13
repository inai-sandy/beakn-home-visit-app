import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-281: POST /api/requests/[id]/target
// =============================================================================
//
// Sets the request's TARGET value (the exec's goal). This replaces the old
// manual-quotation entry: the real quotation now comes from CartPlus and is
// read-only in Beakn. The target never enters finance math.
//
// Auth mirrors the quotation route: assigned exec / captain-of-city /
// super_admin, non-cancelled request. Pass `targetValuePaise: null` to
// clear the target.
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.CAPTAIN,
  USER_ROLES.SUPER_ADMIN,
] as const;

const paramsSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

// ₹1 crore upper bound in paise (matches the quotation validator ceiling).
const MAX_PAISE = 10_000_000_000;
const bodySchema = z.object({
  targetValuePaise: z
    .number()
    .int('Target must be a whole number of paise')
    .positive('Target must be greater than zero')
    .max(MAX_PAISE, 'Target is too large')
    .nullable(),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/target' });

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const reqHeaders = await headersFn();

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

  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json(
      { ok: false, error: paramsParsed.error.issues[0]?.message ?? 'Invalid id' },
      { status: 400 },
    );
  }
  const requestUuid = paramsParsed.data.id;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const bodyParsed = bodySchema.safeParse(bodyRaw);
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
  const { targetValuePaise } = bodyParsed.data;

  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
      before: visitRequests.targetValuePaise,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }

  if (!isAdmin) {
    let allowed = false;
    if (actorRole === USER_ROLES.SALES_EXECUTIVE) {
      allowed = reqRow.assignedExecUserId === actorUserId;
    } else if (actorRole === USER_ROLES.CAPTAIN) {
      allowed = reqRow.cityCaptainUserId === actorUserId;
    }
    if (!allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            actorRole === USER_ROLES.SALES_EXECUTIVE
              ? 'You are not the assigned executive for this request.'
              : 'This request is not in your assigned city.',
        },
        { status: 403 },
      );
    }
  }

  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      { ok: false, error: 'Cannot set a target on a cancelled request.' },
      { status: 409 },
    );
  }

  try {
    await db
      .update(visitRequests)
      .set({ targetValuePaise, updatedAt: new Date() })
      .where(eq(visitRequests.id, requestUuid));

    await logEvent({
      eventType: 'request_target_updated',
      actorUserId,
      actorRole,
      targetEntityType: 'visit_request',
      targetEntityId: requestUuid,
      beforeState: { targetValuePaise: reqRow.before },
      afterState: { targetValuePaise },
      ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: reqHeaders.get('user-agent'),
    });
  } catch (err) {
    apiLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'target_update_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  revalidatePath('/', 'layout');
  return NextResponse.json({ ok: true, targetValuePaise }, { status: 200 });
}
