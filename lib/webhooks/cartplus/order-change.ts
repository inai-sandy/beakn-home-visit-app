import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  quotationLineItems,
  quotations,
  requestOrderChanges,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-325: did this CartPlus edit actually change the order?
// =============================================================================
//
// CartPlus stays editable after we click Order Confirmed, and the webhook
// handler rewrites the quotation on every `order.updated` with no regard for
// how far the request has travelled. Two things were missing: a record, and
// somebody being told.
//
// Both hang off one question — "did anything MATERIAL change?" — so that
// question is answered here, once, by a pure function that can be tested
// without a database.
//
// Material: the total value, or an item added, removed, or amended in
// quantity or unit price.
//
// Not material: product name, SKU, notes. CartPlus fires the same webhook
// for a spelling fix, and a notification that goes off for spelling fixes
// trains people to swipe it away — which costs more than sending nothing.
// =============================================================================

const changeLog = log.child({ component: 'webhooks.cartplus.order_change' });

export const CARTPLUS_ORDER_CHANGED_EVENT = 'webhook.cartplus.order_changed';
const AUDIT_EVENT = 'cartplus_order_changed';

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One line item as it stands in our database, keyed by CartPlus's id. */
export interface LineSnapshot {
  quantity: number;
  unitPricePaise: number;
}

/** The order as it stands BEFORE an incoming edit is applied. */
export interface OrderSnapshot {
  totalPaise: number;
  /** Active (not soft-removed) line items, keyed by portal_line_item_id. */
  lines: Map<number, LineSnapshot>;
}

/** The shape the incoming CartPlus payload contributes to the comparison. */
export interface IncomingLine {
  id: number;
  quantity: number;
  unitPricePaise: number;
}

export interface OrderDiff {
  material: boolean;
  previousTotalPaise: number;
  newTotalPaise: number;
  previousItemCount: number;
  newItemCount: number;
  itemsAdded: number;
  itemsRemoved: number;
  itemsAmended: number;
}

/**
 * Compare what we hold against what CartPlus just sent.
 *
 * Pure — no database, no clock. The handler is hard to exercise across every
 * combination of edit; this is trivial to.
 */
export function diffOrder(
  before: OrderSnapshot,
  incomingTotalPaise: number,
  incoming: readonly IncomingLine[],
): OrderDiff {
  const incomingIds = new Set(incoming.map((l) => l.id));

  let itemsAdded = 0;
  let itemsAmended = 0;
  for (const line of incoming) {
    const prior = before.lines.get(line.id);
    if (!prior) {
      // Either genuinely new, or one that a previous edit soft-removed and
      // this edit brought back. Both are "the order gained an item".
      itemsAdded += 1;
      continue;
    }
    if (
      prior.quantity !== line.quantity ||
      prior.unitPricePaise !== line.unitPricePaise
    ) {
      itemsAmended += 1;
    }
  }

  let itemsRemoved = 0;
  for (const id of before.lines.keys()) {
    if (!incomingIds.has(id)) itemsRemoved += 1;
  }

  const totalChanged = before.totalPaise !== incomingTotalPaise;

  return {
    material:
      totalChanged || itemsAdded > 0 || itemsRemoved > 0 || itemsAmended > 0,
    previousTotalPaise: before.totalPaise,
    newTotalPaise: incomingTotalPaise,
    previousItemCount: before.lines.size,
    newItemCount: incoming.length,
    itemsAdded,
    itemsRemoved,
    itemsAmended,
  };
}

/**
 * Read the order as it stands, BEFORE the handler overwrites it.
 *
 * Must be called inside the handler's existing `FOR UPDATE` transaction and
 * before the quotation update — otherwise the "previous" values are the ones
 * we just wrote, every diff comes back empty, and nobody is ever notified.
 */
export async function snapshotOrder(
  tx: DbTx,
  quotationId: string,
): Promise<OrderSnapshot> {
  const [header] = await tx
    .select({ totalPaise: quotations.totalOrderValuePaise })
    .from(quotations)
    .where(eq(quotations.id, quotationId))
    .limit(1);

  const rows = await tx
    .select({
      portalLineItemId: quotationLineItems.portalLineItemId,
      quantity: quotationLineItems.quantity,
      unitPricePaise: quotationLineItems.unitPricePaise,
    })
    .from(quotationLineItems)
    .where(
      and(
        eq(quotationLineItems.quotationId, quotationId),
        // Soft-removed items are not part of the current order, so a
        // re-add reads as "added" rather than "unchanged".
        isNull(quotationLineItems.removedAt),
      ),
    );

  const lines = new Map<number, LineSnapshot>();
  for (const row of rows) {
    if (row.portalLineItemId === null) continue;
    lines.set(row.portalLineItemId, {
      quantity: row.quantity,
      unitPricePaise: Number(row.unitPricePaise),
    });
  }

  return { totalPaise: Number(header?.totalPaise ?? 0), lines };
}

export interface OrderChangeContext {
  requestId: string;
  customerName: string;
  cityId: string | null;
  cityCaptainUserId: string | null;
  execUserId: string | null;
  stageCode: string;
  stageName: string;
  diff: OrderDiff;
}

/**
 * True when the request has reached Order Confirmed or beyond.
 *
 * Reads the sequence number from `status_stages` rather than comparing
 * against a literal 6 — that number is already hardcoded in three other
 * files, and this is not the place to add a fourth copy.
 */
export async function orderChangeIsReportable(
  tx: DbTx,
  requestId: string,
): Promise<{ reportable: boolean; context: Omit<OrderChangeContext, 'diff'> } | null> {
  const [row] = await tx
    .select({
      currentSeq: statusStages.sequenceNumber,
      stageCode: statusStages.code,
      stageName: statusStages.name,
      customerName: visitRequests.customerName,
      cityId: visitRequests.cityId,
      execUserId: visitRequests.assignedExecUserId,
      confirmedSeq: sql<number>`(
        SELECT s.sequence_number FROM status_stages s WHERE s.code = 'ORDER_CONFIRMED'
      )`,
      cityCaptainUserId: sql<string | null>`(
        SELECT c.captain_user_id FROM cities c WHERE c.id = ${visitRequests.cityId}
      )`,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestId))
    .limit(1);

  if (!row) return null;

  return {
    // Below Order Confirmed an edit is ordinary quoting work, and
    // `webhook.cartplus.order_received` already covers the order arriving.
    reportable: Number(row.currentSeq) >= Number(row.confirmedSeq),
    context: {
      requestId,
      customerName: row.customerName,
      cityId: row.cityId,
      cityCaptainUserId: row.cityCaptainUserId,
      execUserId: row.execUserId,
      stageCode: row.stageCode,
      stageName: row.stageName,
    },
  };
}

/**
 * Write the append-only change record. Runs inside the handler's
 * transaction so the record and the quotation it describes commit together
 * — a record of a change that did not land would be worse than none.
 */
export async function recordOrderChange(
  tx: DbTx,
  args: {
    requestId: string;
    quotationId: string;
    webhookEventId: string | null;
    stageCode: string;
    diff: OrderDiff;
  },
): Promise<void> {
  await tx.insert(requestOrderChanges).values({
    visitRequestId: args.requestId,
    quotationId: args.quotationId,
    webhookEventId: args.webhookEventId,
    previousTotalPaise: args.diff.previousTotalPaise,
    newTotalPaise: args.diff.newTotalPaise,
    previousItemCount: args.diff.previousItemCount,
    newItemCount: args.diff.newItemCount,
    itemsAdded: args.diff.itemsAdded,
    itemsRemoved: args.diff.itemsRemoved,
    itemsAmended: args.diff.itemsAmended,
    stageCode: args.stageCode,
  });
}

/**
 * Announce the change to the internal teams, after the commit.
 *
 * No customer rule exists for this event: CartPlus has already told the
 * customer about the edit they made. Fail-soft — a notification problem must
 * never turn into a 5xx that makes CartPlus retry an edit we have applied.
 */
export async function notifyOrderChanged(
  ctx: OrderChangeContext,
  orderNumber: string | null,
): Promise<void> {
  try {
    const { dispatchNotification } = await import('@/lib/notifications/engine');
    await dispatchNotification(CARTPLUS_ORDER_CHANGED_EVENT, {
      requestId: ctx.requestId,
      customerName: ctx.customerName,
      cityId: ctx.cityId,
      cityCaptainUserId: ctx.cityCaptainUserId,
      execUserId: ctx.execUserId,
      stageCode: ctx.stageCode,
      stageName: ctx.stageName,
      orderNumber,
      previousTotalPaise: ctx.diff.previousTotalPaise,
      newTotalPaise: ctx.diff.newTotalPaise,
      previousItemCount: ctx.diff.previousItemCount,
      newItemCount: ctx.diff.newItemCount,
      itemsAdded: ctx.diff.itemsAdded,
      itemsRemoved: ctx.diff.itemsRemoved,
      itemsAmended: ctx.diff.itemsAmended,
    });

    await logEvent({
      eventType: AUDIT_EVENT,
      actorUserId: null,
      targetEntityType: 'visit_request',
      targetEntityId: ctx.requestId,
      beforeState: {
        totalPaise: ctx.diff.previousTotalPaise,
        itemCount: ctx.diff.previousItemCount,
      },
      afterState: {
        totalPaise: ctx.diff.newTotalPaise,
        itemCount: ctx.diff.newItemCount,
        orderNumber,
        stageCode: ctx.stageCode,
      },
      reason: 'CartPlus order edited after Order Confirmed',
    });

    changeLog.info(
      {
        requestId: ctx.requestId,
        stageCode: ctx.stageCode,
        previousTotalPaise: ctx.diff.previousTotalPaise,
        newTotalPaise: ctx.diff.newTotalPaise,
      },
      'cartplus_order_change_notified',
    );
  } catch (err) {
    changeLog.warn(
      {
        requestId: ctx.requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      'cartplus_order_change_notify_failed',
    );
  }
}
