import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  dispatchItems,
  quotationLineItems,
  quotations,
  statusStages,
  visitRequests,
} from '@/db/schema';

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

const ORDER_CONFIRMED_SEQ = 6;

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

export interface QueueOptions {
  search?: string;
  limit?: number;
  /**
   * HVA-245: filter to a specific dispatch-state bucket.
   *   - 'all'          (default — backwards-compat with HVA-238)
   *   - 'pending'      — qty_dispatched = 0 (no dispatch row yet)
   *   - 'in_progress'  — has at least 1 dispatch row AND
   *                      (qty_remaining > 0 OR any dispatch not handed_off)
   */
  mode?: 'all' | 'pending' | 'in_progress';
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
    AND latest.stage <> 'handed_off'
)`;

export async function loadDispatchQueue(
  options: QueueOptions = {},
): Promise<QueueRow[]> {
  const limit = options.limit ?? 200;
  const trimmedSearch = options.search?.trim().toLowerCase() ?? '';
  const mode = options.mode ?? 'all';

  const conditions = [
    gte(statusStages.sequenceNumber, ORDER_CONFIRMED_SEQ),
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

  const rows = await db
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
    .where(and(...conditions))
    .orderBy(
      desc(PRIORITY_RANK_SQL),
      // NULLs last for target_dispatch_date — Postgres default ASC puts
      // NULLs at the end, which is what we want (items without a target
      // are less urgent than ones with one).
      asc(quotationLineItems.targetDispatchDate),
      asc(quotationLineItems.createdAt),
    )
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    unitPricePaise: Number(r.unitPricePaise),
    quantityRemaining: Number(r.quantityRemaining),
  }));
}

// Lookup of remaining qty for a SET of line items — used by addDispatchAction
// to validate qty inputs against current state in one query.
export async function loadRemainingQuantities(
  lineItemIds: string[],
): Promise<Map<string, { quantityTotal: number; quantityRemaining: number; statusSequence: number }>> {
  if (lineItemIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: quotationLineItems.id,
      quantityTotal: quotationLineItems.quantity,
      quantityRemaining: REMAINING_QTY_SQL,
      statusSequence: statusStages.sequenceNumber,
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
      },
    ]),
  );
}
