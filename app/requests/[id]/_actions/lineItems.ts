'use server';

import { and, asc, eq, max } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { quotationLineItems, quotations, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { canCaptainEditRequest } from '@/lib/captain/edit-auth';
import { canExecEditRequest } from '@/lib/exec/edit-auth';
import {
  lineItemCreateSchema,
  lineItemPrioritySchema,
  lineItemUpdateSchema,
  type LineItemCreateInput,
  type LineItemPriorityInput,
  type LineItemUpdateInput,
} from '@/lib/validators/quotation';

// =============================================================================
// HVA-234 (HVA-231 Phase 1.0): line item server actions
// =============================================================================
//
// Three actions share the same auth shape:
//   - exec assigned to the request can edit
//   - captain of the city (or team) can edit
//   - super_admin always
//
// Auth gate works against the parent quotation's request_id, so the
// existing canExecEditRequest / canCaptainEditRequest helpers apply
// unchanged — no new auth surface introduced.
//
// Mutating semantics:
//   - line_total_paise is ALWAYS server-computed (quantity * unit_price);
//     callers cannot inject a mismatched total.
//   - position is server-assigned on add (next available within the
//     quotation); not re-shuffled on update.
//   - Audit: every action emits an audit_log row (line_item_added /
//     line_item_updated / line_item_priority_changed) so downstream
//     reporting can attribute changes by actor.
// =============================================================================

const ALLOWED_ROLES = [
  USER_ROLES.SALES_EXECUTIVE,
  USER_ROLES.CAPTAIN,
  USER_ROLES.SUPER_ADMIN,
] as const;

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface Actor {
  id: string;
  role: (typeof ALLOWED_ROLES)[number];
}

async function authorize(): Promise<
  { ok: true; actor: Actor } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (!isRole(user.role) || !ALLOWED_ROLES.includes(user.role as Actor['role'])) {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, actor: { id: user.id, role: user.role as Actor['role'] } };
}

async function canEditQuotation(actor: Actor, quotationId: string): Promise<
  { ok: true; requestId: string } | { ok: false; error: string }
> {
  // Find the request the quotation belongs to so we can re-use the
  // existing per-request edit-auth helpers.
  const [quote] = await db
    .select({ id: quotations.id, requestId: quotations.visitRequestId })
    .from(quotations)
    .where(eq(quotations.id, quotationId))
    .limit(1);
  if (!quote) return { ok: false, error: 'Quotation not found' };

  // Reject edits on cancelled requests (matches HVA-70's quotation
  // upsert guard).
  const [req] = await db
    .select({ cancelledAt: visitRequests.cancelledAt })
    .from(visitRequests)
    .where(eq(visitRequests.id, quote.requestId))
    .limit(1);
  if (!req) return { ok: false, error: 'Request not found' };
  if (req.cancelledAt !== null) {
    return { ok: false, error: 'Cannot edit line items on a cancelled request' };
  }

  if (actor.role === USER_ROLES.SUPER_ADMIN) {
    return { ok: true, requestId: quote.requestId };
  }
  if (actor.role === USER_ROLES.SALES_EXECUTIVE) {
    const ok = await canExecEditRequest(actor.id, quote.requestId);
    if (!ok) return { ok: false, error: 'Forbidden' };
    return { ok: true, requestId: quote.requestId };
  }
  // Captain
  const ok = await canCaptainEditRequest(actor.id, quote.requestId);
  if (!ok) return { ok: false, error: 'Forbidden' };
  return { ok: true, requestId: quote.requestId };
}

// -----------------------------------------------------------------------------
// addLineItemAction
// -----------------------------------------------------------------------------

export async function addLineItemAction(
  input: LineItemCreateInput,
): Promise<ActionResult<{ itemId: string }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const parsed = lineItemCreateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const data = parsed.data;

  const gate = await canEditQuotation(auth.actor, data.quotationId);
  if (!gate.ok) return gate;

  // Next position within the quotation. Cheap query — line items per
  // quotation in practice rarely exceed 20.
  const [maxRow] = await db
    .select({ maxPosition: max(quotationLineItems.position) })
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, data.quotationId));
  const position = (maxRow?.maxPosition ?? 0) + 1;

  // Server-authoritative total: never trust the client.
  const lineTotalPaise = data.quantity * data.unitPricePaise;

  const [inserted] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: data.quotationId,
      position,
      productName: data.productName.trim(),
      productSku: data.productSku?.trim() ?? null,
      quantity: data.quantity,
      unitPricePaise: data.unitPricePaise,
      lineTotalPaise,
      gstPercent: data.gstPercent !== undefined ? String(data.gstPercent) : null,
      notes: data.notes?.trim() ?? null,
      priority: data.priority,
      targetDispatchDate: data.targetDispatchDate ?? null,
    })
    .returning({ id: quotationLineItems.id });

  await logEvent({
    eventType: 'line_item_added',
    actorUserId: auth.actor.id,
    actorRole: auth.actor.role,
    targetEntityType: 'quotation',
    targetEntityId: data.quotationId,
    beforeState: null,
    afterState: {
      itemId: inserted.id,
      productName: data.productName,
      productSku: data.productSku ?? null,
      quantity: data.quantity,
      unitPricePaise: data.unitPricePaise,
      lineTotalPaise,
      priority: data.priority,
      targetDispatchDate: data.targetDispatchDate ?? null,
    },
    ipAddress: null,
    userAgent: null,
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { itemId: inserted.id } };
}

// -----------------------------------------------------------------------------
// updateLineItemAction
// -----------------------------------------------------------------------------

export async function updateLineItemAction(
  input: LineItemUpdateInput,
): Promise<ActionResult<{ itemId: string }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const parsed = lineItemUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(quotationLineItems)
    .where(eq(quotationLineItems.id, data.itemId))
    .limit(1);
  if (!existing) return { ok: false, error: 'Line item not found' };

  const gate = await canEditQuotation(auth.actor, existing.quotationId);
  if (!gate.ok) return gate;

  const nextQuantity = data.quantity ?? existing.quantity;
  const nextUnitPrice =
    data.unitPricePaise ?? Number(existing.unitPricePaise);
  const nextLineTotal = nextQuantity * nextUnitPrice;

  await db
    .update(quotationLineItems)
    .set({
      productName:
        data.productName !== undefined
          ? data.productName.trim()
          : existing.productName,
      productSku:
        data.productSku !== undefined
          ? (data.productSku?.trim() ?? null)
          : existing.productSku,
      quantity: nextQuantity,
      unitPricePaise: nextUnitPrice,
      lineTotalPaise: nextLineTotal,
      gstPercent:
        data.gstPercent !== undefined
          ? data.gstPercent !== null
            ? String(data.gstPercent)
            : null
          : existing.gstPercent,
      notes:
        data.notes !== undefined
          ? (data.notes?.trim() ?? null)
          : existing.notes,
      priority: data.priority ?? existing.priority,
      targetDispatchDate:
        data.targetDispatchDate !== undefined
          ? (data.targetDispatchDate ?? null)
          : existing.targetDispatchDate,
      updatedAt: new Date(),
    })
    .where(eq(quotationLineItems.id, data.itemId));

  await logEvent({
    eventType: 'line_item_updated',
    actorUserId: auth.actor.id,
    actorRole: auth.actor.role,
    targetEntityType: 'quotation_line_item',
    targetEntityId: data.itemId,
    beforeState: {
      productName: existing.productName,
      productSku: existing.productSku,
      quantity: existing.quantity,
      unitPricePaise: Number(existing.unitPricePaise),
      lineTotalPaise: Number(existing.lineTotalPaise),
      priority: existing.priority,
      targetDispatchDate: existing.targetDispatchDate,
    },
    afterState: {
      productName:
        data.productName !== undefined ? data.productName : existing.productName,
      productSku:
        data.productSku !== undefined ? data.productSku ?? null : existing.productSku,
      quantity: nextQuantity,
      unitPricePaise: nextUnitPrice,
      lineTotalPaise: nextLineTotal,
      priority: data.priority ?? existing.priority,
      targetDispatchDate:
        data.targetDispatchDate !== undefined
          ? data.targetDispatchDate ?? null
          : existing.targetDispatchDate,
    },
    ipAddress: null,
    userAgent: null,
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { itemId: data.itemId } };
}

// -----------------------------------------------------------------------------
// setLineItemPriorityAction
// -----------------------------------------------------------------------------
// Focused setter for the exec's per-row priority + target date UI. Avoids
// re-validating the rest of the item just to flip these two fields.

export async function setLineItemPriorityAction(
  input: LineItemPriorityInput,
): Promise<ActionResult<{ itemId: string }>> {
  const auth = await authorize();
  if (!auth.ok) return auth;

  const parsed = lineItemPrioritySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const data = parsed.data;

  const [existing] = await db
    .select({
      id: quotationLineItems.id,
      quotationId: quotationLineItems.quotationId,
      priority: quotationLineItems.priority,
      targetDispatchDate: quotationLineItems.targetDispatchDate,
    })
    .from(quotationLineItems)
    .where(eq(quotationLineItems.id, data.itemId))
    .limit(1);
  if (!existing) return { ok: false, error: 'Line item not found' };

  const gate = await canEditQuotation(auth.actor, existing.quotationId);
  if (!gate.ok) return gate;

  await db
    .update(quotationLineItems)
    .set({
      priority: data.priority,
      targetDispatchDate: data.targetDispatchDate ?? null,
      updatedAt: new Date(),
    })
    .where(eq(quotationLineItems.id, data.itemId));

  await logEvent({
    eventType: 'line_item_priority_changed',
    actorUserId: auth.actor.id,
    actorRole: auth.actor.role,
    targetEntityType: 'quotation_line_item',
    targetEntityId: data.itemId,
    beforeState: {
      priority: existing.priority,
      targetDispatchDate: existing.targetDispatchDate,
    },
    afterState: {
      priority: data.priority,
      targetDispatchDate: data.targetDispatchDate ?? null,
    },
    ipAddress: null,
    userAgent: null,
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { itemId: data.itemId } };
}

// -----------------------------------------------------------------------------
// loadLineItems — server-side helper for /requests/[id] rendering
// -----------------------------------------------------------------------------

export interface LineItemRow {
  id: string;
  quotationId: string;
  position: number;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  gstPercent: string | null;
  notes: string | null;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
}

export async function loadLineItems(
  quotationId: string,
): Promise<LineItemRow[]> {
  const rows = await db
    .select({
      id: quotationLineItems.id,
      quotationId: quotationLineItems.quotationId,
      position: quotationLineItems.position,
      productName: quotationLineItems.productName,
      productSku: quotationLineItems.productSku,
      quantity: quotationLineItems.quantity,
      unitPricePaise: quotationLineItems.unitPricePaise,
      lineTotalPaise: quotationLineItems.lineTotalPaise,
      gstPercent: quotationLineItems.gstPercent,
      notes: quotationLineItems.notes,
      priority: quotationLineItems.priority,
      targetDispatchDate: quotationLineItems.targetDispatchDate,
    })
    .from(quotationLineItems)
    .where(eq(quotationLineItems.quotationId, quotationId))
    .orderBy(asc(quotationLineItems.position));
  // bigint values come back as numbers because we set `mode: 'number'`.
  // Cast for stability; date column is text-shaped via Drizzle's `date()`.
  return rows.map((r) => ({
    ...r,
    unitPricePaise: Number(r.unitPricePaise),
    lineTotalPaise: Number(r.lineTotalPaise),
  }));
}
