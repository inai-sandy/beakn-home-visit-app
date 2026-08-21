'use server';

import { revalidatePath } from 'next/cache';

import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { createDispatch } from '@/lib/dispatch/create-dispatch';
import {
  dispatchCreateSchema,
  type DispatchCreateInput,
} from '@/lib/validators/dispatch';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): addDispatchAction
// =============================================================================
//
// Support records a shipment against an order's line items.
//
// HVA-342: the rules that used to live in this file — order at
// ORDER_CONFIRMED and not cancelled, item not removed in CartPlus, quantity
// within what is still owed, plus the transaction, the audit rows and the
// per-request notification fan-out — moved to lib/dispatch/create-dispatch.ts
// when support approving an exec's dispatch request became a second way to
// create a dispatch. Two copies of those rules is how this codebase produced
// the cancelled-order and removed-item bugs (HVA-328, HVA-340), so there is
// one writer now and this action is the session-and-payload half of it.
//
// What stays here, and why: the Zod parse belongs to the untrusted form
// payload this action receives, and the role check belongs to the session.
// Neither is meaningful to the request-approval caller, which has its own
// session and builds its item list from rows it has already read.
// =============================================================================

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

  const result = await createDispatch({
    actorUserId: user.id,
    actorRole: user.role as (typeof ALLOWED_ROLES)[number],
    items: data.items,
    notes: data.notes ?? null,
    courierName: data.courierName ?? null,
    trackingNumber: data.trackingNumber ?? null,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/', 'layout');
  return { ok: true, data: { dispatchId: result.dispatchId } };
}
