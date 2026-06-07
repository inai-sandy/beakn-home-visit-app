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
  /** HVA-246: column to sort by — customer / state / activity. */
  sort?: 'customer' | 'state' | 'activity';
  dir?: 'asc' | 'desc';
  /** HVA-247: filter dropdowns. */
  cityId?: string;
  dispatchState?: OrderDispatchState;
  productName?: string;
  customerPhone?: string;
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
  const sortKey = options.sort;
  const dir = options.dir ?? (sortKey === 'state' ? 'asc' : 'desc');

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

  // HVA-247: filter dropdowns.
  if (options.cityId) {
    conditions.push(eq(visitRequests.cityId, options.cityId));
  }
  if (options.customerPhone) {
    conditions.push(eq(visitRequests.customerPhone, options.customerPhone));
  }
  if (options.productName) {
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ${quotationLineItems} qli_f
      INNER JOIN ${quotations} q_f ON q_f.id = qli_f.quotation_id
      WHERE q_f.visit_request_id = ${visitRequests.id}
        AND qli_f.product_name = ${options.productName}
    )`);
  }
  if (options.dispatchState) {
    // Same logic as the pill resolution below — expressed in SQL so the
    // count + row queries return the same set.
    if (options.dispatchState === 'pending') {
      conditions.push(sql`COALESCE(${itemAggregate.hasAnyDispatch}, FALSE) = FALSE`);
    } else if (options.dispatchState === 'done') {
      conditions.push(sql`COALESCE(${itemAggregate.hasAnyDispatch}, FALSE) = TRUE`);
      conditions.push(
        sql`(${itemAggregate.qtyTotal} - ${itemAggregate.qtyDispatched}) <= 0`,
      );
      conditions.push(sql`COALESCE(${itemAggregate.hasOpenDispatch}, FALSE) = FALSE`);
    } else {
      // in_progress
      conditions.push(sql`COALESCE(${itemAggregate.hasAnyDispatch}, FALSE) = TRUE`);
      conditions.push(
        sql`((${itemAggregate.qtyTotal} - ${itemAggregate.qtyDispatched}) > 0 OR COALESCE(${itemAggregate.hasOpenDispatch}, FALSE) = TRUE)`,
      );
    }
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
      ...(() => {
        // HVA-246: sort key dispatch
        if (sortKey === 'customer') {
          return [
            dir === 'desc'
              ? desc(visitRequests.customerName)
              : asc(visitRequests.customerName),
          ];
        }
        if (sortKey === 'state') {
          // dispatchState ranking in SQL — pending < in_progress < done when asc.
          // Approximate via the raw flags: no_dispatch=0, has_open=1, done=2.
          const stateRankSql = sql`CASE
            WHEN NOT ${itemAggregate.hasAnyDispatch} THEN 0
            WHEN ${itemAggregate.hasOpenDispatch} THEN 1
            ELSE 2
          END`;
          return [dir === 'desc' ? desc(stateRankSql) : asc(stateRankSql)];
        }
        // default + 'activity' → last activity (coalesced to order createdAt)
        const activityExpr = sql`COALESCE(${itemAggregate.lastDispatchAt}, ${visitRequests.createdAt})`;
        return [dir === 'asc' ? asc(activityExpr) : desc(activityExpr)];
      })(),
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
  /** HVA-246: pagination + sort. */
  page?: number;
  pageSize?: number;
  sort?: 'date' | 'customer';
  dir?: 'asc' | 'desc';
  /** HVA-247: filter dropdowns. */
  cityId?: string;
  productName?: string;
  customerPhone?: string;
}

export interface ActivityFeedResult {
  rows: ActivityFeedRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function loadActivityFeed(
  options: ActivityFeedOptions = {},
): Promise<ActivityFeedResult> {
  const limit = options.limit ?? ACTIVITY_LIMIT;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? 25);
  const sortKey = options.sort ?? 'date';
  const dir = options.dir ?? 'desc';

  // HVA-247: filter dropdowns. Activity is a dispatch-level event; filters
  // narrow via EXISTS subqueries on dispatch_items → quotation_line_items →
  // quotations → visit_requests so we don't need extra outer joins.
  const filterConditions = [];
  if (options.cityId) {
    filterConditions.push(sql`EXISTS (
      SELECT 1
      FROM ${dispatchItems} di_f
      INNER JOIN ${quotationLineItems} qli_f ON qli_f.id = di_f.quotation_line_item_id
      INNER JOIN ${quotations} q_f ON q_f.id = qli_f.quotation_id
      INNER JOIN ${visitRequests} vr_f ON vr_f.id = q_f.visit_request_id
      WHERE di_f.dispatch_id = ${dispatches.id}
        AND vr_f.city_id = ${options.cityId}
    )`);
  }
  if (options.productName) {
    filterConditions.push(sql`EXISTS (
      SELECT 1
      FROM ${dispatchItems} di_f
      INNER JOIN ${quotationLineItems} qli_f ON qli_f.id = di_f.quotation_line_item_id
      WHERE di_f.dispatch_id = ${dispatches.id}
        AND qli_f.product_name = ${options.productName}
    )`);
  }
  if (options.customerPhone) {
    filterConditions.push(sql`EXISTS (
      SELECT 1
      FROM ${dispatchItems} di_f
      INNER JOIN ${quotationLineItems} qli_f ON qli_f.id = di_f.quotation_line_item_id
      INNER JOIN ${quotations} q_f ON q_f.id = qli_f.quotation_id
      INNER JOIN ${visitRequests} vr_f ON vr_f.id = q_f.visit_request_id
      WHERE di_f.dispatch_id = ${dispatches.id}
        AND vr_f.customer_phone = ${options.customerPhone}
    )`);
  }

  // Count first — gives us totalCount for pagination footer.
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(dispatchStatusHistory)
    .innerJoin(dispatches, eq(dispatches.id, dispatchStatusHistory.dispatchId))
    .where(filterConditions.length > 0 ? and(...filterConditions) : undefined);
  const totalCount = countRow?.count ?? 0;

  // Sort order: date is on dispatchStatusHistory.changedAt; customer
  // requires joining visit_requests via dispatch_items — done in the
  // second-phase loader below. For 'customer', we fetch a larger window
  // ordered by date desc, sort client-side, then slice.
  const fetchLimit =
    sortKey === 'customer' ? Math.min(limit, 500) : pageSize * page;

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
    .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
    .orderBy(
      sortKey === 'date' && dir === 'asc'
        ? asc(dispatchStatusHistory.changedAt)
        : desc(dispatchStatusHistory.changedAt),
    )
    .limit(fetchLimit);

  if (historyRows.length === 0) {
    return { rows: [], totalCount, page, pageSize };
  }

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

  const mapped = historyRows
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

  // Optional customer sort happens client-side because the SQL would
  // need to join visit_requests for ORDER BY — cheaper to sort the
  // capped window in JS since the page is short.
  if (sortKey === 'customer') {
    mapped.sort((a, b) => {
      const cmp = a.customerName.localeCompare(b.customerName);
      return dir === 'desc' ? -cmp : cmp;
    });
  }

  const startIdx = (page - 1) * pageSize;
  return {
    rows: mapped.slice(startIdx, startIdx + pageSize),
    totalCount,
    page,
    pageSize,
  };
}
