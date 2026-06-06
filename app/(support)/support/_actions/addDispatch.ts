'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import {
  dispatchItems,
  dispatchStatusHistory,
  dispatches,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { loadRemainingQuantities } from '@/lib/support/dispatch-queries';
import {
  dispatchCreateSchema,
  type DispatchCreateInput,
} from '@/lib/validators/dispatch';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): addDispatchAction
// =============================================================================
//
// Writes one dispatches row + N dispatch_items rows + initial
// dispatch_status_history row (stage=created) in a single tx.
//
// Auth: support OR super_admin only.
//
// Validations (in order):
//   1. Zod payload (items array, qty integer > 0)
//   2. All line_item_ids exist
//   3. Each line item's parent request is at ORDER_CONFIRMED+ (sequence >= 6)
//   4. Each qty is <= remaining qty for that line item
//
// On success: emits audit events (dispatch_created + one
// dispatch_item_added per item), revalidates /, returns dispatch id.
// =============================================================================

const ORDER_CONFIRMED_SEQ = 6;
const ALLOWED_ROLES = [USER_ROLES.SUPPORT, USER_ROLES.SUPER_ADMIN] as const;

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function addDispatchAction(
  input: DispatchCreateInput,
): Promise<ActionResult<{ dispatchId: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (
    !user.role ||
    !ALLOWED_ROLES.includes(user.role as (typeof ALLOWED_ROLES)[number])
  ) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = dispatchCreateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const data = parsed.data;

  // Reject duplicate line_item_ids in the same payload (UNIQUE
  // constraint at the DB level would catch this on INSERT, but we
  // surface a clear error here.)
  const seen = new Set<string>();
  for (const it of data.items) {
    if (seen.has(it.lineItemId)) {
      return {
        ok: false,
        error: `Item ${it.lineItemId} appears more than once in this dispatch.`,
      };
    }
    seen.add(it.lineItemId);
  }

  // Single batched query: fetch current remaining + parent stage for
  // every line item being dispatched.
  const ids = data.items.map((it) => it.lineItemId);
  const remainingMap = await loadRemainingQuantities(ids);

  for (const it of data.items) {
    const info = remainingMap.get(it.lineItemId);
    if (!info) {
      return { ok: false, error: `Line item ${it.lineItemId} not found.` };
    }
    if (info.statusSequence < ORDER_CONFIRMED_SEQ) {
      return {
        ok: false,
        error:
          'Cannot dispatch from a request that is not yet at Order Confirmed.',
      };
    }
    if (it.qty > info.quantityRemaining) {
      return {
        ok: false,
        error: `Quantity ${it.qty} exceeds remaining ${info.quantityRemaining} for one of the selected items.`,
      };
    }
  }

  let dispatchId: string;
  try {
    dispatchId = await db.transaction(async (tx) => {
      const [dispatchRow] = await tx
        .insert(dispatches)
        .values({
          dispatchedByUserId: user.id,
          notes: data.notes?.trim() ?? null,
        })
        .returning({ id: dispatches.id });

      for (const it of data.items) {
        await tx.insert(dispatchItems).values({
          dispatchId: dispatchRow.id,
          quotationLineItemId: it.lineItemId,
          qtyInThisDispatch: it.qty,
        });
      }

      await tx.insert(dispatchStatusHistory).values({
        dispatchId: dispatchRow.id,
        stage: 'created',
        changedByUserId: user.id,
      });

      return dispatchRow.id;
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  await logEvent({
    eventType: 'dispatch_created',
    actorUserId: user.id,
    actorRole: user.role as (typeof ALLOWED_ROLES)[number],
    targetEntityType: 'dispatch',
    targetEntityId: dispatchId,
    afterState: {
      itemCount: data.items.length,
      totalQty: data.items.reduce((s, i) => s + i.qty, 0),
      notes: data.notes ?? null,
    },
    ipAddress: null,
    userAgent: null,
  });
  // One audit row per item too — supports per-item reporting later.
  for (const it of data.items) {
    await logEvent({
      eventType: 'dispatch_item_added',
      actorUserId: user.id,
      actorRole: user.role as (typeof ALLOWED_ROLES)[number],
      targetEntityType: 'quotation_line_item',
      targetEntityId: it.lineItemId,
      afterState: { dispatchId, qty: it.qty },
      ipAddress: null,
      userAgent: null,
    });
  }

  revalidatePath('/', 'layout');
  return { ok: true, data: { dispatchId } };
}
