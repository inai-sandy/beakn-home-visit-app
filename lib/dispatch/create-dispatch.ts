// =============================================================================
// HVA-342: one writer for "stock left the building"
// =============================================================================
//
// Until this module there was exactly one way to create a dispatch — support
// filling in the dialog on an order — and all of its rules (order must be at
// ORDER_CONFIRMED and not cancelled, item must not have been removed in
// CartPlus, quantity must not exceed what is still owed) lived inside that
// one server action.
//
// HVA-342 adds a second way in: support approving an exec's dispatch request.
// Writing those rules out a second time is how this codebase has produced
// most of its bugs — the ORDER_CONFIRMED gate alone was once written four
// times and none of the copies considered cancellation (see
// lib/dispatch/eligibility.ts). So the rules move here and both callers go
// through them.
//
// `addDispatchAction` keeps the Zod parse of its untrusted form payload and
// the session/role check; everything downstream of "we have a validated list
// of line items and quantities" is this module's job.
//
// Atomicity: approving a request must record the shipment AND mark the
// request group approved, or neither. Rather than expose the transaction to
// callers, `insideTransaction` runs their write on the same tx immediately
// after the dispatch rows are inserted — so a failure to link the request
// rolls the shipment back with it, and an approved group can never point at
// nothing.
// =============================================================================

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  dispatchItems,
  dispatchStatusHistory,
  dispatches,
  quotationLineItems,
  quotations,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { isDispatchable } from '@/lib/dispatch/eligibility';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { loadRemainingQuantities } from '@/lib/support/dispatch-queries';

/** The transaction handle Drizzle hands to `db.transaction`. */
export type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export interface DispatchLine {
  lineItemId: string;
  qty: number;
}

export interface CreateDispatchInput {
  actorUserId: string;
  /** Only support and super_admin ever reach here; the caller has already
   *  checked. Carried through for the audit rows. */
  actorRole: 'support' | 'super_admin';
  items: DispatchLine[];
  notes?: string | null;
  courierName?: string | null;
  trackingNumber?: string | null;
  /**
   * Runs on the SAME transaction, after the dispatch is written and before
   * it commits. Used by request approval to mark the order group approved
   * atomically. Throwing from here rolls the whole dispatch back.
   */
  insideTransaction?: (tx: DbTransaction, dispatchId: string) => Promise<void>;
}

export type CreateDispatchResult =
  | { ok: true; dispatchId: string }
  | { ok: false; error: string };

/**
 * Validate a set of line items and quantities, then record the shipment.
 *
 * Validation order matters and mirrors what shipped in HVA-328 / HVA-340:
 * eligibility before removal before quantity. A removed item still reports a
 * non-zero raw remaining, so testing the quantity first would wave it
 * through.
 */
export async function createDispatch(
  input: CreateDispatchInput,
): Promise<CreateDispatchResult> {
  if (input.items.length === 0) {
    return { ok: false, error: 'Nothing to dispatch.' };
  }

  // Duplicate line items in one payload would hit the
  // (dispatch_id, quotation_line_item_id) unique index as an opaque DB
  // error; name it here instead.
  const seen = new Set<string>();
  for (const it of input.items) {
    if (seen.has(it.lineItemId)) {
      return {
        ok: false,
        error: `Item ${it.lineItemId} appears more than once in this dispatch.`,
      };
    }
    seen.add(it.lineItemId);
  }

  const remainingMap = await loadRemainingQuantities(
    input.items.map((it) => it.lineItemId),
  );

  for (const it of input.items) {
    const info = remainingMap.get(it.lineItemId);
    if (!info) {
      return { ok: false, error: `Line item ${it.lineItemId} not found.` };
    }
    // HVA-328: stage and cancellation are one question. Checking the stage
    // alone let cancelled orders through — a cancelled request keeps
    // whatever stage it was cancelled at, so it satisfies `sequence >= 6`
    // forever.
    if (!isDispatchable(info)) {
      return {
        ok: false,
        error:
          info.cancelledAt !== null
            ? 'This order was cancelled. It cannot be dispatched — raise a stock recovery instead.'
            : 'Cannot dispatch from a request that is not yet at Order Confirmed.',
      };
    }
    // HVA-340: checked BEFORE the quantity test — removal does not zero the
    // stored quantity, so a removed item sails straight through it.
    if (info.removedAt !== null) {
      return {
        ok: false,
        error:
          'This item was removed from the order in CartPlus. It cannot be dispatched — re-check the current order before shipping anything.',
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
          dispatchedByUserId: input.actorUserId,
          notes: input.notes?.trim() ?? null,
          // HVA-303: optional at creation — the courier is usually booked
          // after the package is packed.
          courierName: input.courierName?.trim() ?? null,
          trackingNumber: input.trackingNumber?.trim() ?? null,
        })
        .returning({ id: dispatches.id });

      for (const it of input.items) {
        await tx.insert(dispatchItems).values({
          dispatchId: dispatchRow.id,
          quotationLineItemId: it.lineItemId,
          qtyInThisDispatch: it.qty,
        });
      }

      await tx.insert(dispatchStatusHistory).values({
        dispatchId: dispatchRow.id,
        stage: 'created',
        changedByUserId: input.actorUserId,
      });

      // Request approval links itself here so the shipment and the approval
      // commit together — see the module note.
      if (input.insideTransaction) {
        await input.insideTransaction(tx, dispatchRow.id);
      }

      return dispatchRow.id;
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  await logEvent({
    eventType: 'dispatch_created',
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    targetEntityType: 'dispatch',
    targetEntityId: dispatchId,
    afterState: {
      itemCount: input.items.length,
      totalQty: input.items.reduce((s, i) => s + i.qty, 0),
      notes: input.notes ?? null,
    },
    ipAddress: null,
    userAgent: null,
  });
  // One audit row per item too — supports per-item reporting later.
  for (const it of input.items) {
    await logEvent({
      eventType: 'dispatch_item_added',
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetEntityType: 'quotation_line_item',
      targetEntityId: it.lineItemId,
      afterState: { dispatchId, qty: it.qty },
      ipAddress: null,
      userAgent: null,
    });
  }

  notifyDispatchRecorded(dispatchId, input);

  return { ok: true, dispatchId };
}

/**
 * HVA-240: fan out per-request notifications. A multi-order dispatch touches
 * several visit_requests and each gets its own `support.dispatch_recorded`
 * event, so the body reflects only what shipped for that customer.
 *
 * Fire-and-forget after the commit — a notification failure must not undo a
 * shipment that physically happened.
 */
function notifyDispatchRecorded(
  dispatchId: string,
  input: CreateDispatchInput,
): void {
  setImmediate(() => {
    void (async () => {
      try {
        const lineItemIds = input.items.map((it) => it.lineItemId);
        const reqRows = await db
          .select({
            requestId: visitRequests.id,
            customerName: visitRequests.customerName,
            cityId: visitRequests.cityId,
            cityName: cities.name,
            cityCaptainUserId: cities.captainUserId,
            assignedExecUserId: visitRequests.assignedExecUserId,
            assignedCaptainUserId: visitRequests.assignedCaptainUserId,
            lineItemId: quotationLineItems.id,
            productName: quotationLineItems.productName,
          })
          .from(quotationLineItems)
          .innerJoin(
            quotations,
            eq(quotations.id, quotationLineItems.quotationId),
          )
          .innerJoin(
            visitRequests,
            eq(visitRequests.id, quotations.visitRequestId),
          )
          .innerJoin(cities, eq(cities.id, visitRequests.cityId))
          .where(inArray(quotationLineItems.id, lineItemIds));

        const [actorRow] = await db
          .select({ fullName: users.fullName })
          .from(users)
          .where(eq(users.id, input.actorUserId))
          .limit(1);
        const actorName = actorRow?.fullName ?? 'Support';

        const perRequest = new Map<
          string,
          {
            customerName: string;
            cityName: string;
            cityId: string;
            cityCaptainUserId: string | null;
            execUserId: string | null;
            captainUserId: string | null;
            items: Array<{ productName: string; qty: number }>;
            totalQty: number;
          }
        >();
        const qtyByItemId = new Map(
          input.items.map((it) => [it.lineItemId, it.qty]),
        );
        for (const row of reqRows) {
          const qty = qtyByItemId.get(row.lineItemId) ?? 0;
          const existing = perRequest.get(row.requestId) ?? {
            customerName: row.customerName,
            cityName: row.cityName,
            cityId: row.cityId,
            cityCaptainUserId: row.cityCaptainUserId,
            execUserId: row.assignedExecUserId,
            captainUserId: row.assignedCaptainUserId,
            items: [] as Array<{ productName: string; qty: number }>,
            totalQty: 0,
          };
          existing.items.push({ productName: row.productName, qty });
          existing.totalQty += qty;
          perRequest.set(row.requestId, existing);
        }

        for (const [requestId, info] of perRequest) {
          const itemSummary = info.items
            .map((i) => `${i.qty}× ${i.productName}`)
            .join(', ');
          await dispatchNotification('support.dispatch_recorded', {
            requestId,
            dispatchId,
            customerName: info.customerName,
            cityId: info.cityId,
            cityName: info.cityName,
            cityCaptainUserId: info.cityCaptainUserId,
            execUserId: info.execUserId,
            captainUserId: info.captainUserId,
            dispatchedByName: actorName,
            itemSummary,
            totalItemsInDispatch: info.totalQty,
          });
        }
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), dispatchId },
          'dispatch_recorded_notification_failed',
        );
      }
    })();
  });
}
