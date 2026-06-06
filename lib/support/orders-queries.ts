import { and, asc, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  dispatchItems,
  dispatchStatusHistory,
  dispatches,
  quotationLineItems,
  quotations,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-245: Orders + Activity queries for support portal
// =============================================================================
//
// loadAllOrders — every ORDER_CONFIRMED+ visit_request, with a computed
//   dispatch-state pill ('pending' | 'in_progress' | 'done') and a
//   last_activity timestamp. Searchable + paginated.
//
// loadActivityFeed — chronological dispatch_status_history entries with
//   author + order context. Capped at 200 rows; grouped by IST date
//   client-side.
// =============================================================================

const ORDER_CONFIRMED_SEQ = 6;
const ORDERS_PAGE_SIZE = 50;
const ACTIVITY_LIMIT = 200;

export type OrderDispatchState = 'pending' | 'in_progress' | 'done';

export interface OrdersListRow {
  requestId: string;
  customerName: string;
  customerPhone: string;
  cityName: string;
  statusStageCode: string;
  statusStageName: string;
  itemsCount: number;
  qtyTotal: number;
  qtyDispatched: number;
  qtyRemaining: number;
  /** Latest dispatch_status_history.changed_at across all items in this
   *  order, OR the order's createdAt if no dispatches yet. Drives sort. */
  lastActivityAt: Date;
  dispatchState: OrderDispatchState;
  orderCreatedAt: Date;
}

export interface OrdersListOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OrdersListResult {
  rows: OrdersListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function loadAllOrders(
  options: OrdersListOptions = {},
): Promise<OrdersListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? ORDERS_PAGE_SIZE;
  const search = options.search?.trim() ?? '';

  // Aggregate item state per request — total qty + dispatched qty +
  // open-dispatch presence. Computed in a CTE so we can use it for the
  // state pill + sort.
  const itemAggregate = db
    .select({
      requestId: quotations.visitRequestId,
      itemsCount: sql<number>`COUNT(*)::int`.as('items_count'),
      qtyTotal:
        sql<number>`COALESCE(SUM(${quotationLineItems.quantity}), 0)::int`.as(
          'qty_total',
        ),
      qtyDispatched: sql<number>`COALESCE(SUM(
        COALESCE((
          SELECT SUM(${dispatchItems.qtyInThisDispatch})
          FROM ${dispatchItems}
          WHERE ${dispatchItems.quotationLineItemId} = ${quotationLineItems.id}
        ), 0)
      ), 0)::int`.as('qty_dispatched'),
      hasAnyDispatch: sql<boolean>`EXISTS (
        SELECT 1
        FROM ${dispatchItems} di
        WHERE di.quotation_line_item_id IN (
          SELECT id FROM quotation_line_items WHERE quotation_id = ${quotations.id}
        )
      )`.as('has_any_dispatch'),
      hasOpenDispatch: sql<boolean>`EXISTS (
        SELECT 1
        FROM ${dispatchItems} di
        JOIN dispatches d ON d.id = di.dispatch_id
        JOIN LATERAL (
          SELECT stage
          FROM dispatch_status_history
          WHERE dispatch_id = d.id
          ORDER BY changed_at DESC
          LIMIT 1
        ) latest ON TRUE
        WHERE di.quotation_line_item_id IN (
          SELECT id FROM quotation_line_items WHERE quotation_id = ${quotations.id}
        )
          AND latest.stage <> 'handed_off'
      )`.as('has_open_dispatch'),
      // HVA-245 fix: postgres-js returns raw timestamp values as strings
      // when the SQL is wrapped in a raw `sql\`\`` template. The Date
      // conversion is done in the mapper below. Type annotation matches
      // the runtime (string | null) so the toISOString crash can't recur.
      lastDispatchAt: sql<string | null>`(
        SELECT MAX(dsh.changed_at)
        FROM dispatch_status_history dsh
        JOIN dispatches d ON d.id = dsh.dispatch_id
        WHERE d.id IN (
          SELECT DISTINCT di.dispatch_id
          FROM ${dispatchItems} di
          WHERE di.quotation_line_item_id IN (
            SELECT id FROM quotation_line_items WHERE quotation_id = ${quotations.id}
          )
        )
      )`.as('last_dispatch_at'),
    })
    .from(quotations)
    .innerJoin(
      quotationLineItems,
      eq(quotationLineItems.quotationId, quotations.id),
    )
    .groupBy(quotations.visitRequestId, quotations.id)
    .as('item_agg');

  const conditions = [gte(statusStages.sequenceNumber, ORDER_CONFIRMED_SEQ)];
  if (search.length > 0) {
    const pattern = `%${search}%`;
    const orClause = or(
      ilike(visitRequests.customerName, pattern),
      ilike(visitRequests.customerPhone, pattern),
      ilike(cities.name, pattern),
    );
    if (orClause) conditions.push(orClause);
  }

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(itemAggregate, eq(itemAggregate.requestId, visitRequests.id))
    .where(and(...conditions));

  const totalCount = countRow?.count ?? 0;

  const rows = await db
    .select({
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
      itemsCount: itemAggregate.itemsCount,
      qtyTotal: itemAggregate.qtyTotal,
      qtyDispatched: itemAggregate.qtyDispatched,
      hasAnyDispatch: itemAggregate.hasAnyDispatch,
      hasOpenDispatch: itemAggregate.hasOpenDispatch,
      lastDispatchAt: itemAggregate.lastDispatchAt,
      orderCreatedAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(itemAggregate, eq(itemAggregate.requestId, visitRequests.id))
    .where(and(...conditions))
    .orderBy(
      // Last activity desc, NULLs treated as the order's createdAt
      desc(
        sql`COALESCE(${itemAggregate.lastDispatchAt}, ${visitRequests.createdAt})`,
      ),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows: rows.map((r) => {
      const itemsCount = Number(r.itemsCount ?? 0);
      const qtyTotal = Number(r.qtyTotal ?? 0);
      const qtyDispatched = Number(r.qtyDispatched ?? 0);
      const qtyRemaining = Math.max(0, qtyTotal - qtyDispatched);
      let dispatchState: OrderDispatchState;
      if (!r.hasAnyDispatch) dispatchState = 'pending';
      else if (qtyRemaining === 0 && !r.hasOpenDispatch) dispatchState = 'done';
      else dispatchState = 'in_progress';
      const lastActivityAt: Date = r.lastDispatchAt
        ? new Date(r.lastDispatchAt)
        : r.orderCreatedAt;
      return {
        requestId: r.requestId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        cityName: r.cityName,
        statusStageCode: r.statusStageCode,
        statusStageName: r.statusStageName,
        itemsCount,
        qtyTotal,
        qtyDispatched,
        qtyRemaining,
        lastActivityAt,
        dispatchState,
        orderCreatedAt: r.orderCreatedAt,
      };
    }),
    totalCount,
    page,
    pageSize,
  };
}

// =============================================================================
// Activity feed
// =============================================================================

export type ActivityEventType = 'dispatch_created' | 'dispatch_packed' | 'dispatch_handed_off';

export interface ActivityFeedRow {
  /** Composite key: dispatchId + stage */
  id: string;
  eventType: ActivityEventType;
  changedAt: Date;
  changedByName: string | null;
  dispatchId: string;
  requestId: string;
  customerName: string;
  cityName: string;
  itemsSummary: string;
  totalQty: number;
}

export interface ActivityFeedOptions {
  limit?: number;
}

export async function loadActivityFeed(
  options: ActivityFeedOptions = {},
): Promise<ActivityFeedRow[]> {
  const limit = options.limit ?? ACTIVITY_LIMIT;

  // One row per (dispatch_id, stage) — chronological event stream.
  const historyRows = await db
    .select({
      historyId: dispatchStatusHistory.id,
      stage: dispatchStatusHistory.stage,
      changedAt: dispatchStatusHistory.changedAt,
      changedByName: users.fullName,
      dispatchId: dispatches.id,
    })
    .from(dispatchStatusHistory)
    .innerJoin(dispatches, eq(dispatches.id, dispatchStatusHistory.dispatchId))
    .leftJoin(
      users,
      eq(users.id, dispatchStatusHistory.changedByUserId),
    )
    .orderBy(desc(dispatchStatusHistory.changedAt))
    .limit(limit);

  if (historyRows.length === 0) return [];

  // Bulk-load items + request context for the dispatches in this batch.
  const dispatchIds = Array.from(new Set(historyRows.map((r) => r.dispatchId)));
  const itemsRows = await db
    .select({
      dispatchId: dispatchItems.dispatchId,
      qty: dispatchItems.qtyInThisDispatch,
      productName: quotationLineItems.productName,
      requestId: quotations.visitRequestId,
      customerName: visitRequests.customerName,
      cityName: cities.name,
    })
    .from(dispatchItems)
    .innerJoin(
      quotationLineItems,
      eq(quotationLineItems.id, dispatchItems.quotationLineItemId),
    )
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(
      sql`${dispatchItems.dispatchId} = ANY(${sql.raw(
        `ARRAY[${dispatchIds.map((id) => `'${id}'::uuid`).join(',')}]`,
      )})`,
    )
    .orderBy(asc(quotationLineItems.position));

  const itemsByDispatch = new Map<
    string,
    {
      requestId: string;
      customerName: string;
      cityName: string;
      itemsSummary: string;
      totalQty: number;
    }
  >();
  for (const row of itemsRows) {
    const existing = itemsByDispatch.get(row.dispatchId);
    if (existing) {
      existing.itemsSummary +=
        existing.itemsSummary.length > 0 ? ', ' : '';
      existing.itemsSummary += `${row.qty}× ${row.productName}`;
      existing.totalQty += row.qty;
    } else {
      itemsByDispatch.set(row.dispatchId, {
        requestId: row.requestId,
        customerName: row.customerName,
        cityName: row.cityName,
        itemsSummary: `${row.qty}× ${row.productName}`,
        totalQty: row.qty,
      });
    }
  }

  return historyRows
    .map((r) => {
      const ctx = itemsByDispatch.get(r.dispatchId);
      if (!ctx) return null;
      const eventType: ActivityEventType =
        r.stage === 'created'
          ? 'dispatch_created'
          : r.stage === 'packed'
            ? 'dispatch_packed'
            : 'dispatch_handed_off';
      return {
        id: r.historyId,
        eventType,
        changedAt: r.changedAt,
        changedByName: r.changedByName,
        dispatchId: r.dispatchId,
        requestId: ctx.requestId,
        customerName: ctx.customerName,
        cityName: ctx.cityName,
        itemsSummary: ctx.itemsSummary,
        totalQty: ctx.totalQty,
      };
    })
    .filter((r): r is ActivityFeedRow => r !== null);
}
