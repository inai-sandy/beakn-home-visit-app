// =============================================================================
// HVA-342: reads for the exec pick list and the support request inbox
// =============================================================================
//
// The pick list is the screen this ticket exists for: instead of a blank
// product field, the exec sees the products their own orders still owe, and
// picks from them.
//
// It reuses `dispatchableConditions()` and the removed-item filter verbatim
// rather than restating them, so the pick list can never offer something the
// dispatch writer would refuse — an exec being allowed to ask for something
// support is then forbidden to ship is a worse failure than not offering it.
// =============================================================================

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  dispatchItems,
  dispatchRequestItems,
  dispatchRequestOrders,
  dispatchRequests,
  quotationLineItems,
  quotations,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { dispatchableConditions } from '@/lib/dispatch/eligibility';

import type {
  DispatchRequestOrderStatus,
  DispatchRequestStatus,
} from './status';

/** Units already shipped against this line item. */
const DISPATCHED_QTY_SQL = sql<number>`COALESCE((
  SELECT SUM(${dispatchItems.qtyInThisDispatch})
  FROM ${dispatchItems}
  WHERE ${dispatchItems.quotationLineItemId} = ${quotationLineItems.id}
), 0)`;

/**
 * Units an exec has already asked for on this line item and nobody has
 * decided yet (pending or held), excluding lines a CartPlus removal
 * cancelled.
 *
 * Without this the pick list would offer the same units again the moment
 * after they were requested, and an exec chasing a customer would cheerfully
 * ask for five more of something they had already asked for. Approved groups
 * are NOT counted here — approval writes real dispatch_items, so those units
 * have already left the remaining figure above.
 */
const RESERVED_QTY_SQL = sql<number>`COALESCE((
  SELECT SUM(dri.quantity)
  FROM dispatch_request_items dri
  JOIN dispatch_request_orders dro
    ON dro.id = dri.dispatch_request_order_id
  JOIN dispatch_requests dr
    ON dr.id = dro.dispatch_request_id
  WHERE dri.quotation_line_item_id = ${quotationLineItems.id}
    AND dri.cancelled_at IS NULL
    AND dro.status IN ('pending', 'held')
    -- A withdrawn request must release its hold. Without this the units
    -- stay reserved forever and the exec can never ask for them again.
    AND dr.status <> 'cancelled'
), 0)`;

export interface PickListItem {
  lineItemId: string;
  productName: string;
  productSku: string | null;
  quantityTotal: number;
  quantityDispatched: number;
  /** Still owed to the customer. */
  quantityRemaining: number;
  /** Already asked for and awaiting a support decision. */
  quantityReserved: number;
  /** What this exec may ask for now: remaining minus reserved, floored at 0. */
  quantityAvailable: number;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
}

export interface PickListOrder {
  requestId: string;
  customerName: string;
  cityName: string;
  items: PickListItem[];
}

/**
 * Every product this exec's confirmed orders still owe, grouped by order.
 *
 * Orders with nothing available (all shipped, or all already requested) are
 * dropped — an order that offers no tickable row is noise on a phone.
 */
export async function loadExecPickList(
  execUserId: string,
): Promise<PickListOrder[]> {
  const rows = await db
    .select({
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      lineItemId: quotationLineItems.id,
      productName: quotationLineItems.productName,
      productSku: quotationLineItems.productSku,
      quantityTotal: quotationLineItems.quantity,
      quantityDispatched: DISPATCHED_QTY_SQL,
      quantityReserved: RESERVED_QTY_SQL,
      priority: quotationLineItems.priority,
      targetDispatchDate: quotationLineItems.targetDispatchDate,
      orderCreatedAt: visitRequests.createdAt,
    })
    .from(quotationLineItems)
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(
      and(
        // HVA-328 / HVA-280: the same two rules the dispatch writer applies.
        ...dispatchableConditions(),
        isNull(quotationLineItems.removedAt),
        eq(visitRequests.assignedExecUserId, execUserId),
        sql`${quotationLineItems.quantity} - ${DISPATCHED_QTY_SQL} > 0`,
      ),
    )
    .orderBy(asc(visitRequests.createdAt), asc(quotationLineItems.position));

  const byOrder = new Map<string, PickListOrder>();
  for (const r of rows) {
    const dispatched = Number(r.quantityDispatched);
    const reserved = Number(r.quantityReserved);
    const remaining = Math.max(0, r.quantityTotal - dispatched);
    const available = Math.max(0, remaining - reserved);
    // Nothing left to ask for on this product — already shipped or already
    // sitting in somebody's open request.
    if (available <= 0) continue;

    const group = byOrder.get(r.requestId) ?? {
      requestId: r.requestId,
      customerName: r.customerName,
      cityName: r.cityName,
      items: [],
    };
    group.items.push({
      lineItemId: r.lineItemId,
      productName: r.productName,
      productSku: r.productSku,
      quantityTotal: r.quantityTotal,
      quantityDispatched: dispatched,
      quantityRemaining: remaining,
      quantityReserved: reserved,
      quantityAvailable: available,
      priority: r.priority,
      targetDispatchDate: r.targetDispatchDate,
    });
    byOrder.set(r.requestId, group);
  }

  return [...byOrder.values()].filter((g) => g.items.length > 0);
}

/**
 * The same availability figures for a specific set of line items, used by the
 * write path to re-check what the browser sent.
 *
 * Deliberately a separate, narrow query rather than filtering the pick list:
 * the write path must not depend on which rows a list query happened to
 * return, and must see the numbers as they are at submit time.
 */
export async function loadAvailabilityForLineItems(
  lineItemIds: string[],
  execUserId: string,
): Promise<
  Map<
    string,
    {
      requestId: string;
      quantityAvailable: number;
      quantityRemaining: number;
    }
  >
> {
  if (lineItemIds.length === 0) return new Map();

  const rows = await db
    .select({
      lineItemId: quotationLineItems.id,
      requestId: visitRequests.id,
      quantityTotal: quotationLineItems.quantity,
      quantityDispatched: DISPATCHED_QTY_SQL,
      quantityReserved: RESERVED_QTY_SQL,
    })
    .from(quotationLineItems)
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(
      and(
        ...dispatchableConditions(),
        isNull(quotationLineItems.removedAt),
        // Scope is part of the guard, not a filter applied earlier: an exec
        // must not be able to request against somebody else's order by
        // posting a line item id they were never shown.
        eq(visitRequests.assignedExecUserId, execUserId),
        inArray(quotationLineItems.id, lineItemIds),
      ),
    );

  return new Map(
    rows.map((r) => {
      const remaining = Math.max(0, r.quantityTotal - Number(r.quantityDispatched));
      return [
        r.lineItemId,
        {
          requestId: r.requestId,
          quantityRemaining: remaining,
          quantityAvailable: Math.max(
            0,
            remaining - Number(r.quantityReserved),
          ),
        },
      ];
    }),
  );
}

export interface RequestListRow {
  id: string;
  status: DispatchRequestStatus;
  priority: 'high' | 'medium' | 'low';
  requiredByDate: string | null;
  message: string | null;
  createdAt: Date;
  execUserId: string;
  execName: string | null;
  groupStatuses: DispatchRequestOrderStatus[];
  orderCount: number;
  itemCount: number;
  totalQty: number;
}

/**
 * List requests, optionally narrowed to one exec.
 *
 * Two queries rather than one join with aggregates: the group statuses drive
 * the summary line, and pulling them as rows keeps the roll-up in
 * `lib/dispatch-requests/status.ts` where it is tested, instead of
 * re-expressing it in SQL.
 */
export async function loadDispatchRequests(options: {
  execUserId?: string;
  status?: DispatchRequestStatus;
  limit?: number;
}): Promise<RequestListRow[]> {
  const conditions = [];
  if (options.execUserId) {
    conditions.push(eq(dispatchRequests.execUserId, options.execUserId));
  }
  if (options.status) {
    conditions.push(eq(dispatchRequests.status, options.status));
  }

  const headers = await db
    .select({
      id: dispatchRequests.id,
      status: dispatchRequests.status,
      priority: dispatchRequests.priority,
      requiredByDate: dispatchRequests.requiredByDate,
      message: dispatchRequests.message,
      createdAt: dispatchRequests.createdAt,
      execUserId: dispatchRequests.execUserId,
      execName: users.fullName,
    })
    .from(dispatchRequests)
    .leftJoin(users, eq(users.id, dispatchRequests.execUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(dispatchRequests.createdAt))
    .limit(options.limit ?? 100);

  if (headers.length === 0) return [];

  const ids = headers.map((h) => h.id);
  const groups = await db
    .select({
      dispatchRequestId: dispatchRequestOrders.dispatchRequestId,
      groupId: dispatchRequestOrders.id,
      status: dispatchRequestOrders.status,
      quantity: dispatchRequestItems.quantity,
      cancelledAt: dispatchRequestItems.cancelledAt,
    })
    .from(dispatchRequestOrders)
    .leftJoin(
      dispatchRequestItems,
      eq(
        dispatchRequestItems.dispatchRequestOrderId,
        dispatchRequestOrders.id,
      ),
    )
    .where(inArray(dispatchRequestOrders.dispatchRequestId, ids));

  const agg = new Map<
    string,
    {
      statuses: Map<string, DispatchRequestOrderStatus>;
      itemCount: number;
      totalQty: number;
    }
  >();
  for (const g of groups) {
    const entry = agg.get(g.dispatchRequestId) ?? {
      statuses: new Map<string, DispatchRequestOrderStatus>(),
      itemCount: 0,
      totalQty: 0,
    };
    entry.statuses.set(g.groupId, g.status);
    // A cancelled line (the customer deleted the product) still shows on the
    // detail page but must not inflate "you asked for 12 units".
    if (g.quantity !== null && g.cancelledAt === null) {
      entry.itemCount += 1;
      entry.totalQty += g.quantity;
    }
    agg.set(g.dispatchRequestId, entry);
  }

  return headers.map((h) => {
    const entry = agg.get(h.id);
    const groupStatuses = entry ? [...entry.statuses.values()] : [];
    return {
      ...h,
      groupStatuses,
      orderCount: groupStatuses.length,
      itemCount: entry?.itemCount ?? 0,
      totalQty: entry?.totalQty ?? 0,
    };
  });
}

export interface RequestDetailItem {
  id: string;
  lineItemId: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  cancelledAt: Date | null;
  cancelledReason: string | null;
}

export interface RequestDetailGroup {
  id: string;
  requestId: string;
  customerName: string;
  cityName: string;
  status: DispatchRequestOrderStatus;
  dispatchId: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionReason: string | null;
  items: RequestDetailItem[];
}

export interface RequestDetail {
  id: string;
  status: DispatchRequestStatus;
  priority: 'high' | 'medium' | 'low';
  requiredByDate: string | null;
  message: string | null;
  createdAt: Date;
  execUserId: string;
  execName: string | null;
  groups: RequestDetailGroup[];
}

export async function loadDispatchRequestDetail(
  id: string,
): Promise<RequestDetail | null> {
  const [header] = await db
    .select({
      id: dispatchRequests.id,
      status: dispatchRequests.status,
      priority: dispatchRequests.priority,
      requiredByDate: dispatchRequests.requiredByDate,
      message: dispatchRequests.message,
      createdAt: dispatchRequests.createdAt,
      execUserId: dispatchRequests.execUserId,
      execName: users.fullName,
    })
    .from(dispatchRequests)
    .leftJoin(users, eq(users.id, dispatchRequests.execUserId))
    .where(eq(dispatchRequests.id, id))
    .limit(1);

  if (!header) return null;

  const decider = users;
  const groupRows = await db
    .select({
      id: dispatchRequestOrders.id,
      requestId: dispatchRequestOrders.visitRequestId,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      status: dispatchRequestOrders.status,
      dispatchId: dispatchRequestOrders.dispatchId,
      decidedAt: dispatchRequestOrders.decidedAt,
      decidedByName: decider.fullName,
      decisionReason: dispatchRequestOrders.decisionReason,
    })
    .from(dispatchRequestOrders)
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, dispatchRequestOrders.visitRequestId),
    )
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(decider, eq(decider.id, dispatchRequestOrders.decidedByUserId))
    .where(eq(dispatchRequestOrders.dispatchRequestId, id))
    .orderBy(asc(dispatchRequestOrders.createdAt));

  const groupIds = groupRows.map((g) => g.id);
  const itemRows =
    groupIds.length === 0
      ? []
      : await db
          .select({
            id: dispatchRequestItems.id,
            groupId: dispatchRequestItems.dispatchRequestOrderId,
            lineItemId: dispatchRequestItems.quotationLineItemId,
            productName: quotationLineItems.productName,
            productSku: quotationLineItems.productSku,
            quantity: dispatchRequestItems.quantity,
            cancelledAt: dispatchRequestItems.cancelledAt,
            cancelledReason: dispatchRequestItems.cancelledReason,
          })
          .from(dispatchRequestItems)
          .innerJoin(
            quotationLineItems,
            eq(quotationLineItems.id, dispatchRequestItems.quotationLineItemId),
          )
          .where(
            inArray(dispatchRequestItems.dispatchRequestOrderId, groupIds),
          )
          .orderBy(asc(dispatchRequestItems.createdAt));

  const itemsByGroup = new Map<string, RequestDetailItem[]>();
  for (const it of itemRows) {
    const list = itemsByGroup.get(it.groupId) ?? [];
    list.push({
      id: it.id,
      lineItemId: it.lineItemId,
      productName: it.productName,
      productSku: it.productSku,
      quantity: it.quantity,
      cancelledAt: it.cancelledAt,
      cancelledReason: it.cancelledReason,
    });
    itemsByGroup.set(it.groupId, list);
  }

  return {
    ...header,
    groups: groupRows.map((g) => ({
      ...g,
      items: itemsByGroup.get(g.id) ?? [],
    })),
  };
}

/**
 * Support's inbox: undecided order groups, most urgent first.
 *
 * Sorted by the exec's stated priority then their required-by date, which is
 * the only reason those two fields are collected at all.
 */
export async function loadSupportRequestInbox(options?: {
  includeHeld?: boolean;
  limit?: number;
}): Promise<RequestDetailGroup[]> {
  const wanted: DispatchRequestOrderStatus[] = options?.includeHeld === false
    ? ['pending']
    : ['pending', 'held'];

  const decider = users;
  const groupRows = await db
    .select({
      id: dispatchRequestOrders.id,
      requestId: dispatchRequestOrders.visitRequestId,
      dispatchRequestId: dispatchRequestOrders.dispatchRequestId,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      status: dispatchRequestOrders.status,
      dispatchId: dispatchRequestOrders.dispatchId,
      decidedAt: dispatchRequestOrders.decidedAt,
      decidedByName: decider.fullName,
      decisionReason: dispatchRequestOrders.decisionReason,
      priority: dispatchRequests.priority,
      requiredByDate: dispatchRequests.requiredByDate,
      createdAt: dispatchRequests.createdAt,
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
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(decider, eq(decider.id, dispatchRequestOrders.decidedByUserId))
    .where(inArray(dispatchRequestOrders.status, wanted))
    .orderBy(
      // high → medium → low. The enum's own order would sort the wrong way.
      sql`CASE ${dispatchRequests.priority}
        WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END DESC`,
      sql`${dispatchRequests.requiredByDate} ASC NULLS LAST`,
      asc(dispatchRequests.createdAt),
    )
    .limit(options?.limit ?? 200);

  const groupIds = groupRows.map((g) => g.id);
  if (groupIds.length === 0) return [];

  const itemRows = await db
    .select({
      id: dispatchRequestItems.id,
      groupId: dispatchRequestItems.dispatchRequestOrderId,
      lineItemId: dispatchRequestItems.quotationLineItemId,
      productName: quotationLineItems.productName,
      productSku: quotationLineItems.productSku,
      quantity: dispatchRequestItems.quantity,
      cancelledAt: dispatchRequestItems.cancelledAt,
      cancelledReason: dispatchRequestItems.cancelledReason,
    })
    .from(dispatchRequestItems)
    .innerJoin(
      quotationLineItems,
      eq(quotationLineItems.id, dispatchRequestItems.quotationLineItemId),
    )
    .where(inArray(dispatchRequestItems.dispatchRequestOrderId, groupIds))
    .orderBy(asc(dispatchRequestItems.createdAt));

  const itemsByGroup = new Map<string, RequestDetailItem[]>();
  for (const it of itemRows) {
    const list = itemsByGroup.get(it.groupId) ?? [];
    list.push({
      id: it.id,
      lineItemId: it.lineItemId,
      productName: it.productName,
      productSku: it.productSku,
      quantity: it.quantity,
      cancelledAt: it.cancelledAt,
      cancelledReason: it.cancelledReason,
    });
    itemsByGroup.set(it.groupId, list);
  }

  return groupRows.map((g) => ({
    id: g.id,
    requestId: g.requestId,
    customerName: g.customerName,
    cityName: g.cityName,
    status: g.status,
    dispatchId: g.dispatchId,
    decidedAt: g.decidedAt,
    decidedByName: g.decidedByName,
    decisionReason: g.decisionReason,
    items: itemsByGroup.get(g.id) ?? [],
  }));
}
