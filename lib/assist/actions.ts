'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import {
  assistRequestItems,
  assistRequestStatusHistory,
  assistRequests,
  salesExecutives,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getServerSession } from '@/lib/auth-server';
import { isRole } from '@/lib/auth/roles';
import { dispatchNotification } from '@/lib/notifications/engine';

import { canTransitionTo, type AssistPriority, type AssistStatus } from './types';

// HVA-199: server actions for the Assist domain.
//
// Three actions, all returning ActionResult<T>; never throw to callers.
// Audit + notification dispatch are fire-and-forget after the DB
// transition lands.

export type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

export interface AssistItemInput {
  productName: string;
  quantity: number;
}

export interface CreateAssistRequestInput {
  items: AssistItemInput[];
  orderNumber?: string | null;
  dispatchByDate?: string | null; // YYYY-MM-DD
  priority?: AssistPriority;
  message?: string | null;
  linkedVisitRequestId?: string | null;
}

export interface UpdateAssistRequestInput extends CreateAssistRequestInput {
  assistId: string;
}

export interface TransitionAssistStatusInput {
  assistId: string;
  toStatus: AssistStatus;
  reason?: string | null;
}

// ---------------------------------------------------------------------------
// createAssistRequestAction (exec only)
// ---------------------------------------------------------------------------

export async function createAssistRequestAction(
  input: CreateAssistRequestInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive') {
    return { ok: false, error: 'forbidden' };
  }

  // Validate items shape if present. Empty list is allowed (form's
  // nothing-mandatory rule); rejected by DB only on the CHECK constraint
  // (quantity > 0) which kicks in per-row.
  const items = Array.isArray(input.items) ? input.items : [];
  for (const item of items) {
    if (
      typeof item.productName !== 'string' ||
      item.productName.trim().length === 0
    ) {
      return { ok: false, error: 'invalid_item_name' };
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, error: 'invalid_item_quantity' };
    }
  }

  // Optional linked visit_request must belong to this exec.
  if (input.linkedVisitRequestId) {
    const [vrow] = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.id, input.linkedVisitRequestId),
          eq(visitRequests.assignedExecUserId, session.user.id),
        ),
      )
      .limit(1);
    if (!vrow) return { ok: false, error: 'invalid_linked_visit_request' };
  }

  // Captain lookup for the assist.created dispatch — engine resolver reads
  // context.assistCaptainUserId. captain_user_id on sales_executives is
  // NOT NULL so this should always exist.
  const [execRow] = await db
    .select({ captainUserId: salesExecutives.captainUserId })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, session.user.id))
    .limit(1);

  const [inserted] = await db
    .insert(assistRequests)
    .values({
      execUserId: session.user.id,
      type: 'material_request',
      status: 'submitted',
      orderNumber: input.orderNumber ?? null,
      dispatchByDate: input.dispatchByDate ?? null,
      priority: input.priority ?? 'medium',
      message: input.message ?? null,
      linkedVisitRequestId: input.linkedVisitRequestId ?? null,
    })
    .returning({ id: assistRequests.id });

  if (items.length > 0) {
    await db.insert(assistRequestItems).values(
      items.map((i) => ({
        assistRequestId: inserted.id,
        productName: i.productName.trim(),
        quantity: i.quantity,
      })),
    );
  }

  await db.insert(assistRequestStatusHistory).values({
    assistRequestId: inserted.id,
    fromStatus: null,
    toStatus: 'submitted',
    changedByUserId: session.user.id,
    reason: null,
  });

  // Audit + notification dispatch. Both swallow errors so a downstream
  // failure can't break the create flow.
  await logEvent({
    eventType: 'assist.created',
    actorUserId: session.user.id,
    actorRole: isRole(role) ? role : undefined,
    targetEntityType: 'assist_request',
    targetEntityId: inserted.id,
    afterState: {
      type: 'material_request',
      itemCount: items.length,
      priority: input.priority ?? 'medium',
    },
  });

  setImmediate(() => {
    dispatchNotification('assist.created', {
      assistId: inserted.id,
      assistExecUserId: session.user.id,
      assistCaptainUserId: execRow?.captainUserId ?? null,
      itemCount: items.length,
      priority: input.priority ?? 'medium',
      orderNumber: input.orderNumber ?? null,
    }).catch(() => {
      // never block on notification failure
    });
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { id: inserted.id } };
}

// ---------------------------------------------------------------------------
// updateAssistRequestAction (exec only, status=submitted only)
// ---------------------------------------------------------------------------

export async function updateAssistRequestAction(
  input: UpdateAssistRequestInput,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive') {
    return { ok: false, error: 'forbidden' };
  }

  // Ownership + status gate. Type is immutable after create so we don't
  // touch it.
  const [existing] = await db
    .select({
      id: assistRequests.id,
      execUserId: assistRequests.execUserId,
      status: assistRequests.status,
    })
    .from(assistRequests)
    .where(eq(assistRequests.id, input.assistId))
    .limit(1);
  if (!existing) return { ok: false, error: 'assist_not_found' };
  if (existing.execUserId !== session.user.id) {
    return { ok: false, error: 'forbidden' };
  }
  if (existing.status !== 'submitted') {
    return { ok: false, error: 'locked_after_captain_action' };
  }

  const items = Array.isArray(input.items) ? input.items : [];
  for (const item of items) {
    if (
      typeof item.productName !== 'string' ||
      item.productName.trim().length === 0
    ) {
      return { ok: false, error: 'invalid_item_name' };
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, error: 'invalid_item_quantity' };
    }
  }

  if (input.linkedVisitRequestId) {
    const [vrow] = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.id, input.linkedVisitRequestId),
          eq(visitRequests.assignedExecUserId, session.user.id),
        ),
      )
      .limit(1);
    if (!vrow) return { ok: false, error: 'invalid_linked_visit_request' };
  }

  await db
    .update(assistRequests)
    .set({
      orderNumber: input.orderNumber ?? null,
      dispatchByDate: input.dispatchByDate ?? null,
      priority: input.priority ?? 'medium',
      message: input.message ?? null,
      linkedVisitRequestId: input.linkedVisitRequestId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(assistRequests.id, input.assistId));

  // Items are append-only by schema (CASCADE delete on parent) but for
  // the editable phase we replace the whole set: simpler UX than tracking
  // diffs, and rows are only ever touched while status='submitted'.
  await db
    .delete(assistRequestItems)
    .where(eq(assistRequestItems.assistRequestId, input.assistId));
  if (items.length > 0) {
    await db.insert(assistRequestItems).values(
      items.map((i) => ({
        assistRequestId: input.assistId,
        productName: i.productName.trim(),
        quantity: i.quantity,
      })),
    );
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// transitionAssistStatusAction (captain team-scoped + admin global)
// ---------------------------------------------------------------------------

export async function transitionAssistStatusAction(
  input: TransitionAssistStatusInput,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const role = (session.user as { role?: string }).role;
  if (role !== 'captain' && role !== 'super_admin') {
    return { ok: false, error: 'forbidden' };
  }

  const [existing] = await db
    .select({
      id: assistRequests.id,
      status: assistRequests.status,
      execUserId: assistRequests.execUserId,
    })
    .from(assistRequests)
    .where(eq(assistRequests.id, input.assistId))
    .limit(1);
  if (!existing) return { ok: false, error: 'assist_not_found' };

  // Idempotent: already at target → ok.
  if (existing.status === input.toStatus) {
    return { ok: true };
  }

  if (!canTransitionTo(existing.status, input.toStatus)) {
    return { ok: false, error: `illegal_transition_${existing.status}_to_${input.toStatus}` };
  }

  // Captain team scope: must own the exec.
  if (role === 'captain') {
    const [scopeRow] = await db
      .select({ captainUserId: salesExecutives.captainUserId })
      .from(salesExecutives)
      .where(eq(salesExecutives.userId, existing.execUserId))
      .limit(1);
    if (!scopeRow || scopeRow.captainUserId !== session.user.id) {
      return { ok: false, error: 'not_in_team_scope' };
    }
  }

  // Concurrency-safe transition: WHERE includes the expected from_status
  // so two simultaneous Approve clicks don't both succeed.
  const updateResult = await db
    .update(assistRequests)
    .set({
      status: input.toStatus,
      rejectionReason:
        input.toStatus === 'rejected' ? input.reason ?? null : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(assistRequests.id, input.assistId),
        eq(assistRequests.status, existing.status),
      ),
    )
    .returning({ id: assistRequests.id });
  if (updateResult.length === 0) {
    return { ok: false, error: 'concurrent_update_lost' };
  }

  await db.insert(assistRequestStatusHistory).values({
    assistRequestId: input.assistId,
    fromStatus: existing.status,
    toStatus: input.toStatus,
    changedByUserId: session.user.id,
    reason: input.reason ?? null,
  });

  // Exec's captain (for the dispatch context — admin events route to
  // super_admin role which resolves internally).
  const [execTeam] = await db
    .select({ captainUserId: salesExecutives.captainUserId })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, existing.execUserId))
    .limit(1);

  await logEvent({
    eventType: `assist.${input.toStatus}` as
      | 'assist.approved'
      | 'assist.processing'
      | 'assist.dispatched'
      | 'assist.rejected',
    actorUserId: session.user.id,
    actorRole: isRole(role) ? role : undefined,
    targetEntityType: 'assist_request',
    targetEntityId: input.assistId,
    beforeState: { status: existing.status },
    afterState: { status: input.toStatus },
    reason: input.reason ?? null,
  });

  setImmediate(() => {
    dispatchNotification(`assist.${input.toStatus}`, {
      assistId: input.assistId,
      assistExecUserId: existing.execUserId,
      assistCaptainUserId: execTeam?.captainUserId ?? null,
      fromStatus: existing.status,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
    }).catch(() => {
      // never block on notification failure
    });
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
