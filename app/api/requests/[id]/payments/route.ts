import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  payments,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { getConfig } from '@/lib/config';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { paymentSchema } from '@/lib/validators/payment';

// =============================================================================
// HVA-70: POST /api/requests/[id]/payments
// =============================================================================
//
// Records a payment row. Supports inbound (customer paid) and outbound
// (refund) entries.
//
// RBAC:
//   - inbound  → assigned exec, captain-of-city, super_admin
//   - outbound → captain-of-city or super_admin ONLY (HVA-70 deviation
//                #4: the assigned exec CANNOT issue refunds)
//
// Deviations baked in:
//   * Ad-hoc only — no milestone enum, no auto-cap to remaining balance.
//   * NO automatic status transition when paid in full (deviation #3).
//   * Cancelled requests cannot accept new payments.
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

const apiLog = log.child({ route: '/api/requests/[id]/payments' });

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
  const bodyParsed = paymentSchema.safeParse(bodyRaw);
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
  const body = bodyParsed.data;

  // 4. Load the request + city captain.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      // captain_payment_received WhatsApp body reads {{4}} = exec name;
      // LEFT JOIN users so unassigned requests still resolve (rare for
      // payments, but defensive).
      execName: users.fullName,
      customerName: visitRequests.customerName,
      cityId: visitRequests.cityId,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      cancelledAt: visitRequests.cancelledAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) {
    return NextResponse.json({ ok: false, error: 'Request not found' }, { status: 404 });
  }

  // 5. Per-request authorization — direction-sensitive.
  const isExec = actorRole === USER_ROLES.SALES_EXECUTIVE;
  const isCaptainOfCity =
    actorRole === USER_ROLES.CAPTAIN && reqRow.cityCaptainUserId === actorUserId;

  if (!isAdmin) {
    if (body.direction === 'outbound') {
      // HVA-70 deviation #4: refunds are captain/admin ONLY.
      if (!isCaptainOfCity) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Refunds can only be issued by the captain of the request city or super_admin.',
          },
          { status: 403 },
        );
      }
    } else {
      // inbound — exec assigned to this request, or captain of city.
      let allowed = false;
      if (isExec) {
        allowed = reqRow.assignedExecUserId === actorUserId;
      } else if (actorRole === USER_ROLES.CAPTAIN) {
        allowed = isCaptainOfCity;
      }
      if (!allowed) {
        return NextResponse.json(
          {
            ok: false,
            error: isExec
              ? 'You are not the assigned executive for this request.'
              : "This request is not in your assigned city.",
          },
          { status: 403 },
        );
      }
    }
  }

  // 6. Cancelled-request guard.
  if (reqRow.cancelledAt !== null) {
    return NextResponse.json(
      { ok: false, error: 'Cannot record a payment on a cancelled/rejected request.' },
      { status: 409 },
    );
  }

  // 6b. HVA-224: refund window. When the admin-configured
  // `refund_window_days` > 0, an outbound payment is rejected if
  // ORDER_CONFIRMED happened more than that many days ago. Window = 0
  // disables the check (refunds always allowed). Window applies only to
  // refunds whose request has actually been confirmed — pre-confirmation
  // deposit refunds (rare) are not gated.
  if (body.direction === 'outbound') {
    const refundWindowDays = await getConfig('refund_window_days');
    if (refundWindowDays > 0) {
      const [orderConfirmedRow] = await db
        .select({ changedAt: requestStatusHistory.changedAt })
        .from(requestStatusHistory)
        .innerJoin(
          statusStages,
          eq(statusStages.id, requestStatusHistory.toStatusStageId),
        )
        .where(
          and(
            eq(requestStatusHistory.requestId, requestUuid),
            eq(statusStages.code, 'ORDER_CONFIRMED'),
          ),
        )
        .orderBy(desc(requestStatusHistory.transitionOrder))
        .limit(1);

      if (orderConfirmedRow) {
        const daysSinceConfirmed = Math.floor(
          (Date.now() - orderConfirmedRow.changedAt.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (daysSinceConfirmed > refundWindowDays) {
          return NextResponse.json(
            {
              ok: false,
              error: `Refund window closed — order was confirmed ${daysSinceConfirmed} days ago (window is ${refundWindowDays} days). Contact admin to change the window.`,
            },
            { status: 409 },
          );
        }
      }
    }
  }

  // 7. Insert.
  let resultRow: typeof payments.$inferSelect;
  try {
    const [inserted] = await db
      .insert(payments)
      .values({
        visitRequestId: requestUuid,
        direction: body.direction,
        amountPaise: body.amountPaise,
        paymentDate: body.paymentDate,
        mode: body.mode,
        label: body.label ?? null,
        referenceNumber: body.referenceNumber ?? null,
        notes: body.notes ?? null,
        recordedByUserId: actorUserId,
      })
      .returning();
    resultRow = inserted!;
  } catch (err) {
    reqLog.error(
      { err: err instanceof Error ? err.message : String(err) },
      'payment_insert_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  // 8. Audit — distinct event_type for refunds so reports can split them.
  await logEvent({
    eventType: body.direction === 'outbound' ? 'refund_recorded' : 'payment_recorded',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestUuid,
    beforeState: null,
    afterState: {
      paymentId: resultRow.id,
      direction: resultRow.direction,
      amountPaise: resultRow.amountPaise,
      paymentDate: resultRow.paymentDate,
      mode: resultRow.mode,
      label: resultRow.label,
      referenceNumber: resultRow.referenceNumber,
      notes: resultRow.notes,
    },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-125: emit `payment.received` for inbound payments. Stub-level — no
  // composer / rule exists yet, but the dispatch site is wired so later
  // notification rules pick it up without revisiting the route. Refunds
  // (outbound) intentionally don't emit here; they have a separate event
  // type if/when we add one.
  if (body.direction === 'inbound') {
    setImmediate(() => {
      dispatchNotification('payment.received', {
        requestId: requestUuid,
        customerName: reqRow.customerName,
        cityId: reqRow.cityId,
        cityName: reqRow.cityName,
        cityCaptainUserId: reqRow.cityCaptainUserId,
        execUserId: reqRow.assignedExecUserId,
        // captain_payment_received template body params.
        execName: reqRow.execName ?? 'A team member',
        amountPaise: resultRow.amountPaise,
        paymentMode: resultRow.mode,
        paymentDate: resultRow.paymentDate,
        recordedByUserId: actorUserId,
      }).catch((err) => {
        reqLog.error(
          { err: err instanceof Error ? err.message : String(err) },
          'payment_received_dispatch_failed',
        );
      });
    });
  }

  // HVA-143: client Router Cache invalidation for sibling pages.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      payment: {
        id: resultRow.id,
        visitRequestId: resultRow.visitRequestId,
        direction: resultRow.direction,
        amountPaise: resultRow.amountPaise,
        paymentDate: resultRow.paymentDate,
        mode: resultRow.mode,
        label: resultRow.label,
        referenceNumber: resultRow.referenceNumber,
        notes: resultRow.notes,
        recordedByUserId: resultRow.recordedByUserId,
        createdAt: resultRow.createdAt,
      },
    },
    { status: 201 },
  );
}
