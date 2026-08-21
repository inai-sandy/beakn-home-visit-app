'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import {
  dispatchRequestItems,
  dispatchRequestOrders,
  dispatchRequests,
  quotationLineItems,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { isRole, USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { createDispatch } from '@/lib/dispatch/create-dispatch';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import {
  dispatchRequestCreateSchema,
  dispatchRequestDecisionSchema,
  type DispatchRequestCreateInput,
  type DispatchRequestDecisionInput,
} from '@/lib/validators/dispatch-request';

import { loadAvailabilityForLineItems } from './queries';
import { deriveRequestStatus, type DispatchRequestOrderStatus } from './status';

// =============================================================================
// HVA-342: exec asks for stock; support decides, and approving actually ships
// =============================================================================
//
// The rule that makes this different from the Assist section it replaces:
// nothing here accepts a product name. The exec posts line item ids, every
// one of which is re-checked against THEIR OWN orders before anything is
// written — so a request cannot reference a product that is not on an order,
// or an order that is not theirs, however the payload was constructed.
//
// Approval does not set a status. It calls the same dispatch writer support's
// own dialog calls, on the same transaction that marks the group approved.
// That is the whole point of the ticket: "approved" and "shipped" cannot come
// apart, because they are one write.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const SUPPORT_ROLES = [USER_ROLES.SUPPORT, USER_ROLES.SUPER_ADMIN] as const;

function fieldErrorsFrom(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join('.');
    if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

// ---------------------------------------------------------------------------
// Exec: raise a request
// ---------------------------------------------------------------------------

export async function createDispatchRequestAction(
  input: DispatchRequestCreateInput,
): Promise<ActionResult<{ requestId: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  // Exec only. The pick list is scoped by `assigned_exec_user_id`, so any
  // other role would see an empty list anyway — but the check belongs on the
  // write, not on the read that happened to feed it.
  if (user.role !== USER_ROLES.SALES_EXECUTIVE) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = dispatchRequestCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const data = parsed.data;

  const seen = new Set<string>();
  for (const it of data.items) {
    if (seen.has(it.lineItemId)) {
      return { ok: false, error: 'The same product appears twice.' };
    }
    seen.add(it.lineItemId);
  }

  // Re-read availability at submit time. The browser's copy can be minutes
  // old, and in that window support may have shipped some of it or the
  // customer may have deleted the product in CartPlus.
  const availability = await loadAvailabilityForLineItems(
    data.items.map((it) => it.lineItemId),
    user.id,
  );

  const byOrder = new Map<string, { lineItemId: string; qty: number }[]>();
  for (const it of data.items) {
    const info = availability.get(it.lineItemId);
    if (!info) {
      return {
        ok: false,
        error:
          'One of these products is no longer available to request — it may have been removed from the order, or the order may not be yours.',
      };
    }
    if (info.quantityAvailable <= 0) {
      return {
        ok: false,
        error:
          'One of these products has nothing left to request. Refresh and try again.',
      };
    }
    if (it.qty > info.quantityAvailable) {
      return {
        ok: false,
        error: `You asked for ${it.qty} of a product with only ${info.quantityAvailable} left to request. Refresh and try again.`,
      };
    }
    const list = byOrder.get(info.requestId) ?? [];
    list.push({ lineItemId: it.lineItemId, qty: it.qty });
    byOrder.set(info.requestId, list);
  }

  let requestId: string;
  try {
    requestId = await db.transaction(async (tx) => {
      const [header] = await tx
        .insert(dispatchRequests)
        .values({
          execUserId: user.id,
          priority: data.priority,
          requiredByDate: data.requiredByDate ?? null,
          message: data.message ?? null,
        })
        .returning({ id: dispatchRequests.id });

      for (const [visitRequestId, items] of byOrder) {
        const [group] = await tx
          .insert(dispatchRequestOrders)
          .values({
            dispatchRequestId: header.id,
            visitRequestId,
          })
          .returning({ id: dispatchRequestOrders.id });

        for (const it of items) {
          await tx.insert(dispatchRequestItems).values({
            dispatchRequestOrderId: group.id,
            quotationLineItemId: it.lineItemId,
            quantity: it.qty,
          });
        }
      }

      return header.id;
    });
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'dispatch_request_create_failed',
    );
    return { ok: false, error: 'Could not save the request. Try again.' };
  }

  const totalQty = data.items.reduce((s, i) => s + i.qty, 0);

  await logEvent({
    eventType: 'dispatch_request_created',
    actorUserId: user.id,
    actorRole: USER_ROLES.SALES_EXECUTIVE,
    targetEntityType: 'dispatch_request',
    targetEntityId: requestId,
    afterState: {
      orderCount: byOrder.size,
      itemCount: data.items.length,
      totalQty,
      priority: data.priority,
      requiredByDate: data.requiredByDate ?? null,
    },
    ipAddress: null,
    userAgent: null,
  });

  const [execRow] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  void dispatchNotification('dispatch_request.created', {
    dispatchRequestId: requestId,
    dispatchRequestExecUserId: user.id,
    execName: execRow?.fullName ?? null,
    orderCount: byOrder.size,
    itemCount: data.items.length,
    totalQty,
    priority: data.priority,
    requiredByDate: data.requiredByDate ?? null,
  }).catch((err: unknown) => {
    log.error(
      { err: err instanceof Error ? err.message : String(err), requestId },
      'dispatch_request_created_notification_failed',
    );
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { requestId } };
}

// ---------------------------------------------------------------------------
// Exec: withdraw a request
// ---------------------------------------------------------------------------

/**
 * Withdrawing releases the units the request was holding — see the
 * `dr.status <> 'cancelled'` clause in RESERVED_QTY_SQL. Groups that support
 * already decided keep their decision; only the header changes, because a
 * shipment that went out is not undone by the exec changing their mind.
 */
export async function cancelDispatchRequestAction(
  requestId: string,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };

  const [header] = await db
    .select({
      id: dispatchRequests.id,
      execUserId: dispatchRequests.execUserId,
      status: dispatchRequests.status,
    })
    .from(dispatchRequests)
    .where(eq(dispatchRequests.id, requestId))
    .limit(1);

  if (!header) return { ok: false, error: 'Request not found' };
  if (
    header.execUserId !== user.id &&
    user.role !== USER_ROLES.SUPER_ADMIN
  ) {
    return { ok: false, error: 'Forbidden' };
  }
  if (header.status === 'cancelled') return { ok: true };
  if (header.status === 'closed') {
    return {
      ok: false,
      error: 'This request is already finished and cannot be withdrawn.',
    };
  }

  await db
    .update(dispatchRequests)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(dispatchRequests.id, requestId));

  await logEvent({
    eventType: 'dispatch_request_cancelled',
    actorUserId: user.id,
    actorRole: isRole(user.role) ? user.role : undefined,
    targetEntityType: 'dispatch_request',
    targetEntityId: requestId,
    afterState: { status: 'cancelled' },
    ipAddress: null,
    userAgent: null,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Support: decide one order group
// ---------------------------------------------------------------------------

export async function decideDispatchRequestOrderAction(
  input: DispatchRequestDecisionInput,
): Promise<ActionResult<{ dispatchId?: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (
    !user.role ||
    !SUPPORT_ROLES.includes(user.role as (typeof SUPPORT_ROLES)[number])
  ) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = dispatchRequestDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: fieldErrorsFrom(parsed.error.issues),
    };
  }
  const data = parsed.data;

  const [group] = await db
    .select({
      id: dispatchRequestOrders.id,
      status: dispatchRequestOrders.status,
      dispatchRequestId: dispatchRequestOrders.dispatchRequestId,
      visitRequestId: dispatchRequestOrders.visitRequestId,
      customerName: visitRequests.customerName,
      execUserId: dispatchRequests.execUserId,
      requestStatus: dispatchRequests.status,
    })
    .from(dispatchRequestOrders)
    .innerJoin(
      dispatchRequests,
      eq(dispatchRequests.id, dispatchRequestOrders.dispatchRequestId),
    )
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, dispatchRequestOrders.visitRequestId),
    )
    .where(eq(dispatchRequestOrders.id, data.orderGroupId))
    .limit(1);

  if (!group) return { ok: false, error: 'Request not found' };
  if (group.requestStatus === 'cancelled') {
    return {
      ok: false,
      error: 'The executive withdrew this request.',
    };
  }
  if (group.status === 'approved' || group.status === 'rejected') {
    return { ok: false, error: 'This order has already been decided.' };
  }

  // Only live lines. A product the customer deleted in CartPlus was
  // cancelled by the sweep in lib/webhooks/cartplus/cancel-request-items.ts
  // and must not be shipped.
  const liveItems = await db
    .select({
      lineItemId: dispatchRequestItems.quotationLineItemId,
      qty: dispatchRequestItems.quantity,
      productName: quotationLineItems.productName,
    })
    .from(dispatchRequestItems)
    .innerJoin(
      quotationLineItems,
      eq(quotationLineItems.id, dispatchRequestItems.quotationLineItemId),
    )
    .where(
      and(
        eq(dispatchRequestItems.dispatchRequestOrderId, group.id),
        isNull(dispatchRequestItems.cancelledAt),
      ),
    );

  const itemSummary = liveItems
    .map((i) => `${i.qty}× ${i.productName}`)
    .join(', ');

  let dispatchId: string | undefined;
  const now = new Date();

  if (data.decision === 'approve') {
    if (liveItems.length === 0) {
      return {
        ok: false,
        error:
          'Every product on this order was removed in CartPlus. There is nothing left to dispatch — decline it instead.',
      };
    }

    // The shipment and the approval commit together. If the group update
    // fails, the dispatch rolls back with it — an approved group can never
    // point at nothing, and stock can never leave without the request
    // recording that it did.
    const result = await createDispatch({
      actorUserId: user.id,
      actorRole: user.role as (typeof SUPPORT_ROLES)[number],
      items: liveItems.map((i) => ({ lineItemId: i.lineItemId, qty: i.qty })),
      notes: data.reason ?? null,
      courierName: data.courierName ?? null,
      trackingNumber: data.trackingNumber ?? null,
      insideTransaction: async (tx, newDispatchId) => {
        await tx
          .update(dispatchRequestOrders)
          .set({
            status: 'approved',
            dispatchId: newDispatchId,
            decidedByUserId: user.id,
            decidedAt: now,
            decisionReason: data.reason ?? null,
            updatedAt: now,
          })
          .where(eq(dispatchRequestOrders.id, group.id));
      },
    });

    if (!result.ok) return { ok: false, error: result.error };
    dispatchId = result.dispatchId;
  } else {
    const nextStatus: DispatchRequestOrderStatus =
      data.decision === 'hold' ? 'held' : 'rejected';
    await db
      .update(dispatchRequestOrders)
      .set({
        status: nextStatus,
        decidedByUserId: user.id,
        decidedAt: now,
        decisionReason: data.reason ?? null,
        updatedAt: now,
      })
      .where(eq(dispatchRequestOrders.id, group.id));
  }

  await refreshRequestStatus(group.dispatchRequestId);

  await logEvent({
    eventType: `dispatch_request_${data.decision}d`,
    actorUserId: user.id,
    actorRole: isRole(user.role) ? user.role : undefined,
    targetEntityType: 'dispatch_request_order',
    targetEntityId: group.id,
    afterState: {
      decision: data.decision,
      dispatchId: dispatchId ?? null,
      reason: data.reason ?? null,
    },
    ipAddress: null,
    userAgent: null,
  });

  const eventType =
    data.decision === 'approve'
      ? 'dispatch_request.approved'
      : data.decision === 'hold'
        ? 'dispatch_request.held'
        : 'dispatch_request.rejected';

  void dispatchNotification(eventType, {
    dispatchRequestId: group.dispatchRequestId,
    dispatchRequestExecUserId: group.execUserId,
    requestId: group.visitRequestId,
    customerName: group.customerName,
    itemSummary,
    reason: data.reason ?? null,
  }).catch((err: unknown) => {
    log.error(
      {
        err: err instanceof Error ? err.message : String(err),
        groupId: group.id,
      },
      'dispatch_request_decision_notification_failed',
    );
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { dispatchId } };
}

/**
 * Recompute the header from its groups.
 *
 * Derived rather than set at the decision site, so a request cannot end up
 * 'closed' with a group still waiting on somebody — the failure the old
 * hand-set assist status made easy.
 */
async function refreshRequestStatus(dispatchRequestId: string): Promise<void> {
  const rows = await db
    .select({ status: dispatchRequestOrders.status })
    .from(dispatchRequestOrders)
    .where(eq(dispatchRequestOrders.dispatchRequestId, dispatchRequestId));

  const next = deriveRequestStatus(rows.map((r) => r.status));

  await db
    .update(dispatchRequests)
    .set({ status: next, updatedAt: new Date() })
    .where(
      and(
        eq(dispatchRequests.id, dispatchRequestId),
        // Never resurrect a withdrawn request by recomputing it.
        inArray(dispatchRequests.status, ['open', 'closed']),
      ),
    );
}
