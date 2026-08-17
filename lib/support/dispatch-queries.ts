import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  dispatchItems,
  quotationLineItems,
  quotations,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { buildRequestsScopeWhere } from '@/lib/captain/requests-queries';
import { dispatchableConditions } from '@/lib/dispatch/eligibility';
import { CLOSED_DISPATCH_STAGES_SQL } from '@/lib/validators/dispatch-stage';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): support dispatch queue queries
// =============================================================================
//
// The /support queue shows every line item across orders that:
//   1. Belongs to a visit_request whose status_stage.sequence_number >= 6
//      (ORDER_CONFIRMED or beyond), AND
//   2. Has remaining qty > 0 (qty_total - SUM(dispatch_items.qty))
//
// Sorted by:
//   - priority desc (high > med > low)
//   - target_dispatch_date asc (earliest first; NULLs last)
//   - created_at asc (oldest pending first)
//
// Filters (URL params):
//   - q: substring on customer name OR product name (case-insensitive)

// Priority mapping for ORDER BY: high(3) > med(2) > low(1). SQL CASE
// pivot since PostgreSQL ENUMs sort by definition order which would
// give low → med → high (wrong direction for our DESC sort).
const PRIORITY_RANK_SQL = sql`CASE ${quotationLineItems.priority}
  WHEN 'high' THEN 3
  WHEN 'med'  THEN 2
  WHEN 'low'  THEN 1
END`;

// Remaining qty per line item = total - SUM(dispatch_items.qty)
const REMAINING_QTY_SQL = sql<number>`(
  ${quotationLineItems.quantity} - COALESCE((
    SELECT SUM(${dispatchItems.qtyInThisDispatch})
    FROM ${dispatchItems}
    WHERE ${dispatchItems.quotationLineItemId} = ${quotationLineItems.id}
  ), 0)
)`;

export interface QueueRow {
  lineItemId: string;
  requestId: string;
  productName: string;
  productSku: string | null;
  quantityTotal: number;
  quantityRemaining: number;
  unitPricePaise: number;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
  customerName: string;
  cityName: string;
  orderCreatedAt: Date;
  itemCreatedAt: Date;
}

/**
 * HVA-308: who is allowed to see these rows.
 *
 * Support is a global pool and passes nothing — they see every order.
 * Exec and captain get their own Dispatch section and must be scoped to
 * exactly the orders their Requests list already shows, or the two
 * screens would disagree about what they own.
 */
export type DispatchQueueScope =
  | { kind: 'all' }
  | { kind: 'exec'; execUserId: string }
  | {
      kind: 'captain';
      captainUserId?: string;
      cityIds: string[];
      isSuperAdmin: boolean;
    };

export interface QueueOptions {
  search?: string;
  limit?: number;
  /** HVA-308: role scoping. Defaults to unscoped (support). */
  scope?: DispatchQueueScope;
  /**
   * HVA-245: filter to a specific dispatch-state bucket.
   *   - 'all'          (default — backwards-compat with HVA-238)
   *   - 'pending'      — qty_dispatched = 0 (no dispatch row yet)
   *   - 'in_progress'  — has at least 1 dispatch row AND
   *                      (qty_remaining > 0 OR any dispatch not handed_off)
   */
  mode?: 'all' | 'pending' | 'in_progress';
  /** HVA-246: pagination + sort. */
  page?: number;
  pageSize?: number;
  sort?: 'customer' | 'product' | 'age';
  dir?: 'asc' | 'desc';
  /** HVA-247: filter dropdowns. */
  cityId?: string;
  productName?: string;
  customerPhone?: string;
}

export interface QueueResult {
  rows: QueueRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

const DISPATCHED_QTY_SUM_SQL = sql<number>`COALESCE((
  SELECT SUM(${dispatchItems.qtyInThisDispatch})
  FROM ${dispatchItems}
  WHERE ${dispatchItems.quotationLineItemId} = ${quotationLineItems.id}
), 0)`;

// True when the line item has any dispatch row that hasn't reached
// handed_off as its LATEST stage. Used by the in_progress bucket so
// items whose qty_remaining is 0 but whose courier hasn't handed them
// off still show up.
const HAS_OPEN_DISPATCH_SQL = sql<boolean>`EXISTS (
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
  WHERE di.quotation_line_item_id = ${quotationLineItems.id}
    -- HVA-304: 'delivered' is closed too — see CLOSED_DISPATCH_STAGES.
    AND latest.stage NOT IN (${sql.raw(CLOSED_DISPATCH_STAGES_SQL)})
)`;

/**
 * HVA-308: every WHERE clause for the queue, in one place.
 *
 * Extracted so the row query and the summary tiles can never diverge —
 * a summary that counts a different set than the list below it is worse
 * than no summary at all.
 */
function buildQueueConditions(options: QueueOptions) {
  const trimmedSearch = options.search?.trim().toLowerCase() ?? '';
  const mode = options.mode ?? 'all';

  const conditions = [
    // HVA-328: ORDER_CONFIRMED+ AND not cancelled. This is a work queue —
    // a cancelled order is not work anybody should be asked to do.
    ...dispatchableConditions(),
    // HVA-280: items a CartPlus edit removed from the order must not
    // appear as available to dispatch.
    isNull(quotationLineItems.removedAt),
  ];

  if (mode === 'pending') {
    // Nothing dispatched yet — qty_dispatched = 0 (no dispatch_items rows)
    // AND qty_remaining = quantity (always true when dispatched_sum = 0).
    conditions.push(sql`${DISPATCHED_QTY_SUM_SQL} = 0`);
  } else if (mode === 'in_progress') {
    // Has at least one dispatch row AND either remaining > 0 OR a
    // dispatch row that's not handed off yet.
    conditions.push(sql`${DISPATCHED_QTY_SUM_SQL} > 0`);
    conditions.push(
      sql`(${REMAINING_QTY_SQL} > 0 OR ${HAS_OPEN_DISPATCH_SQL})`,
    );
  } else {
    // 'all' (legacy queue behaviour) — anything with remaining > 0.
    conditions.push(sql`${REMAINING_QTY_SQL} > 0`);
  }

  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`;
    conditions.push(
      sql`(
        LOWER(${visitRequests.customerName}) LIKE ${pattern}
        OR LOWER(${quotationLineItems.productName}) LIKE ${pattern}
      )`,
    );
  }

  // HVA-247: filter dropdowns.
  if (options.cityId) {
    conditions.push(eq(visitRequests.cityId, options.cityId));
  }
  if (options.productName) {
    conditions.push(eq(quotationLineItems.productName, options.productName));
  }
  if (options.customerPhone) {
    conditions.push(eq(visitRequests.customerPhone, options.customerPhone));
  }

  // HVA-308: role scope. Applied last so it always narrows, never widens.
  const scope = options.scope;
  if (scope && scope.kind === 'exec') {
    conditions.push(eq(visitRequests.assignedExecUserId, scope.execUserId));
  } else if (scope && scope.kind === 'captain' && !scope.isSuperAdmin) {
    // Reuse the Requests-list predicate verbatim so a captain's Dispatch
    // section covers exactly the orders their Requests tab covers.
    const captainWhere = buildRequestsScopeWhere({
      captainUserId: scope.captainUserId,
      cityIds: scope.cityIds,
      isSuperAdmin: false,
    });
    if (captainWhere) conditions.push(captainWhere);
  }

  return conditions;
}

export async function loadDispatchQueue(
  options: QueueOptions = {},
): Promise<QueueResult> {
  const limit = options.limit ?? 200;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? 25);
  const sortKey = options.sort;
  const dir = options.dir ?? (sortKey ? 'asc' : 'asc');

  const conditions = buildQueueConditions(options);

  // HVA-246: sort selection. Defaults match HVA-238 behaviour (priority
  // desc → target asc → created asc). User-driven sort keys override the
  // primary column; secondary tiebreakers stay so equal-customer rows
  // still come out deterministic.
  let orderByClauses;
  if (sortKey === 'customer') {
    orderByClauses = [
      dir === 'desc'
        ? desc(visitRequests.customerName)
        : asc(visitRequests.customerName),
      asc(quotationLineItems.createdAt),
    ];
  } else if (sortKey === 'product') {
    orderByClauses = [
      dir === 'desc'
        ? desc(quotationLineItems.productName)
        : asc(quotationLineItems.productName),
      asc(quotationLineItems.createdAt),
    ];
  } else if (sortKey === 'age') {
    orderByClauses = [
      // Older order = higher age. asc dir = oldest first.
      dir === 'desc'
        ? desc(visitRequests.createdAt)
        : asc(visitRequests.createdAt),
    ];
  } else {
    orderByClauses = [
      desc(PRIORITY_RANK_SQL),
      asc(quotationLineItems.targetDispatchDate),
      asc(quotationLineItems.createdAt),
    ];
  }

  const baseQuery = db
    .select({
      lineItemId: quotationLineItems.id,
      requestId: visitRequests.id,
      productName: quotationLineItems.productName,
      productSku: quotationLineItems.productSku,
      quantityTotal: quotationLineItems.quantity,
      // Cast bigint sum back to number — REMAINING_QTY_SQL evaluates as
      // integer because both operands are integer (quantity int + qty_in_this_dispatch int).
      quantityRemaining: REMAINING_QTY_SQL,
      unitPricePaise: quotationLineItems.unitPricePaise,
      priority: quotationLineItems.priority,
      targetDispatchDate: quotationLineItems.targetDispatchDate,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      orderCreatedAt: visitRequests.createdAt,
      itemCreatedAt: quotationLineItems.createdAt,
    })
    .from(quotationLineItems)
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(...conditions));

  // Count for pagination footer. Done as a separate query to keep the
  // main query LIMIT/OFFSET-cleanable; could be merged with a window
  // function but the page is small enough that two roundtrips are fine.
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(quotationLineItems)
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(...conditions));

  const totalCount = countRow?.count ?? 0;

  const rows = await baseQuery
    .orderBy(...orderByClauses)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Honour the legacy `limit` cap when caller didn't paginate. Used by
  // /admin tools etc. that still call without page/sort options.
  if (!options.page && !options.sort && !options.dir && limit < pageSize) {
    return {
      rows: rows
        .slice(0, limit)
        .map((r) => ({
          ...r,
          unitPricePaise: Number(r.unitPricePaise),
          quantityRemaining: Number(r.quantityRemaining),
        })),
      totalCount,
      page: 1,
      pageSize,
    };
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      unitPricePaise: Number(r.unitPricePaise),
      quantityRemaining: Number(r.quantityRemaining),
    })),
    totalCount,
    page,
    pageSize,
  };
}

// Lookup of remaining qty for a SET of line items — used by addDispatchAction
// to validate qty inputs against current state in one query.
export async function loadRemainingQuantities(
  lineItemIds: string[],
): Promise<
  Map<
    string,
    {
      quantityTotal: number;
      quantityRemaining: number;
      statusSequence: number;
      // HVA-328: the write guard needs cancellation, not just the stage.
      cancelledAt: Date | null;
      // HVA-340: ...and removal, which this was not even selecting. The
      // queue filters removed items out so they are unreachable from there,
      // but the order detail page listed them with a working dispatch form
      // — and this lookup was the last thing between that form and real
      // stock leaving against an item the customer had deleted.
      removedAt: Date | null;
    }
  >
> {
  if (lineItemIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: quotationLineItems.id,
      quantityTotal: quotationLineItems.quantity,
      quantityRemaining: REMAINING_QTY_SQL,
      statusSequence: statusStages.sequenceNumber,
      cancelledAt: visitRequests.cancelledAt,
      removedAt: quotationLineItems.removedAt,
    })
    .from(quotationLineItems)
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(
      sql`${quotationLineItems.id} = ANY(${sql.raw(
        `ARRAY[${lineItemIds.map((id) => `'${id}'::uuid`).join(',')}]`,
      )})`,
    );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        quantityTotal: r.quantityTotal,
        quantityRemaining: Number(r.quantityRemaining),
        statusSequence: r.statusSequence,
        cancelledAt: r.cancelledAt,
        removedAt: r.removedAt,
      },
    ]),
  );
}

// =============================================================================
// HVA-308: summary tiles for the exec / captain Dispatch section
// =============================================================================
//
// Shares buildQueueConditions with loadDispatchQueue, so the totals always
// describe exactly the rows listed underneath them — including the active
// mode filter and role scope.
//
// Counts are DISTINCT on order and product because a single order can have
// several outstanding products and the same product can be outstanding on
// several orders; summing rows would double-count both.
// =============================================================================

export interface DispatchQueueSummary {
  /** Units still to go out across every matching line item. */
  unitsPending: number;
  /** Orders with at least one outstanding line item. */
  ordersPending: number;
  /** Distinct product names still to ship. */
  productsPending: number;
}

export async function loadDispatchQueueSummary(
  options: QueueOptions = {},
): Promise<DispatchQueueSummary> {
  const conditions = buildQueueConditions(options);

  const [row] = await db
    .select({
      unitsPending: sql<number>`COALESCE(SUM(${REMAINING_QTY_SQL}), 0)::int`,
      ordersPending: sql<number>`COUNT(DISTINCT ${visitRequests.id})::int`,
      productsPending: sql<number>`COUNT(DISTINCT ${quotationLineItems.productName})::int`,
    })
    .from(quotationLineItems)
    .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(...conditions));

  return {
    unitsPending: Number(row?.unitsPending ?? 0),
    ordersPending: Number(row?.ordersPending ?? 0),
    productsPending: Number(row?.productsPending ?? 0),
  };
}
