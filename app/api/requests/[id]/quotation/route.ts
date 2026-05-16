import { eq } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, quotations, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';
import { quotationUpsertSchema } from '@/lib/validators/quotation';

// =============================================================================
// HVA-70: POST /api/requests/[id]/quotation
// =============================================================================
//
// Upsert endpoint. Captain-of-city, assigned exec, or super_admin can
// create OR revise the quotation. Quotations are MUTABLE per HVA-70's
// design — every revision is audited via quotation_updated.
//
// Deviations from Linear body baked in here:
//   * No quotation builder / GST / PDF — only headline total + optional
//     quotation_number + optional notes.
//   * MUTATING is allowed (HVA-70 explicit deviation #5).
//   * NO automatic request status transition when totalOrderValuePaise
//     becomes non-zero or matches payments sum (deviation #3).
//
// Cancelled-request guard: quotation cannot be created/updated on a
// terminal request (cancelled_at IS NOT NULL).
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.CAPTAIN,
  USER_ROLES.SUPER_ADMIN,
] as const;

const paramsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

interface Ctx {
  params: Promise<{ id: string }>;
}

const apiLog = log.child({ route: '/api/requests/[id]/quotation' });

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const reqHeaders = await headersFn();
  const correlationId = reqHeaders.get('x-request-id') ?? undefined;
  const reqLog = apiLog.child({ correlationId });

  // 1. Auth + role gate.
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
      { ok: false, error: paramsParsed.error.issues[0]?.message ?? 'Invalid id' },
      { status: 400 },
    );
  }
  const requestUuid = paramsParsed.data.id;

  // 3. Validate body.
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const bodyParsed = quotationUpsertSchema.safeParse(bodyRaw);
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
  const { totalOrderValuePaise, quotationNumber, notes } = bodyParsed.data;

  // 4. Load request + city captain.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }

  // 5. Per-request authorization.
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
              : "This request is not in your assigned city.",
        },
        { status: 403 },
      );
    }
  }

  // 6. Cancelled-request guard.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      { ok: false, error: 'Cannot update quotation on a cancelled/rejected request.' },
      { status: 409 },
    );
  }

  // 7. Look up existing quotation row to decide create vs update.
  const [existing] = await db
    .select()
    .from(quotations)
    .where(eq(quotations.visitRequestId, requestUuid))
    .limit(1);

  const now = new Date();
  let resultRow: typeof quotations.$inferSelect;

  try {
    if (!existing) {
      // CREATE
      const [inserted] = await db
        .insert(quotations)
        .values({
          visitRequestId: requestUuid,
          quotationNumber: quotationNumber ?? null,
          totalOrderValuePaise,
          notes: notes ?? null,
          submittedByUserId: actorUserId,
          submittedAt: now,
        })
        .returning();
      resultRow = inserted!;

      await logEvent({
        eventType: 'quotation_created',
        actorUserId,
        actorRole,
        targetEntityType: 'visit_request',
        targetEntityId: requestUuid,
        beforeState: null,
        afterState: {
          quotationId: resultRow.id,
          totalOrderValuePaise: resultRow.totalOrderValuePaise,
          quotationNumber: resultRow.quotationNumber,
          notes: resultRow.notes,
        },
        ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: reqHeaders.get('user-agent'),
      });
    } else {
      // UPDATE — record the before+after for the audit trail.
      const [updated] = await db
        .update(quotations)
        .set({
          quotationNumber: quotationNumber ?? null,
          totalOrderValuePaise,
          notes: notes ?? null,
          updatedByUserId: actorUserId,
          updatedAt: now,
        })
        .where(eq(quotations.id, existing.id))
        .returning();
      resultRow = updated!;

      await logEvent({
        eventType: 'quotation_updated',
        actorUserId,
        actorRole,
        targetEntityType: 'visit_request',
        targetEntityId: requestUuid,
        beforeState: {
          quotationId: existing.id,
          totalOrderValuePaise: existing.totalOrderValuePaise,
          quotationNumber: existing.quotationNumber,
          notes: existing.notes,
        },
        afterState: {
          quotationId: resultRow.id,
          totalOrderValuePaise: resultRow.totalOrderValuePaise,
          quotationNumber: resultRow.quotationNumber,
          notes: resultRow.notes,
        },
        ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: reqHeaders.get('user-agent'),
      });
    }
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'quotation_upsert_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      quotation: {
        id: resultRow.id,
        visitRequestId: resultRow.visitRequestId,
        quotationNumber: resultRow.quotationNumber,
        totalOrderValuePaise: resultRow.totalOrderValuePaise,
        notes: resultRow.notes,
        submittedByUserId: resultRow.submittedByUserId,
        submittedAt: resultRow.submittedAt,
        updatedByUserId: resultRow.updatedByUserId,
        updatedAt: resultRow.updatedAt,
      },
    },
    { status: existing ? 200 : 201 },
  );
}
