import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, sql } from 'drizzle-orm';

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
// HVA-239 (HVA-231 Phase 2 PR-B): support order detail loader
// =============================================================================
//
// Loads the request header, all line items (incl. fully-dispatched), and
// the full dispatch history for /support/orders/[id].
// =============================================================================

export interface OrderItemRow {
  id: string;
  productName: string;
  productSku: string | null;
  quantityTotal: number;
  quantityDispatched: number;
  quantityRemaining: number;
  unitPricePaise: number;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
}

export interface DispatchHistoryEntry {
  dispatchId: string;
  createdAt: Date;
  dispatchedByUserId: string;
  dispatchedByName: string | null;
  notes: string | null;
  currentStage: 'created' | 'packed' | 'handed_off';
  items: Array<{
    lineItemId: string;
    productName: string;
    qty: number;
  }>;
}

export interface OrderDetail {
  request: {
    id: string;
    customerName: string;
    customerPhone: string;
    cityName: string;
    statusStageCode: string;
    statusStageName: string;
    statusSequence: number;
    execName: string | null;
    captainName: string | null;
    createdAt: Date;
  };
  items: OrderItemRow[];
  dispatches: DispatchHistoryEntry[];
}

// Correlated subquery — raw SQL to avoid any Drizzle interpolation
// surprises with subquery FROM clauses.
const DISPATCHED_QTY_SQL = sql<number>`COALESCE((SELECT SUM(qty_in_this_dispatch) FROM dispatch_items WHERE quotation_line_item_id = quotation_line_items.id), 0)`;

export async function loadOrderDetail(
  requestId: string,
): Promise<OrderDetail | null> {
  const execAlias = alias(users, 'exec_user');
  const captainAlias = alias(users, 'captain_user');

  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
      statusSequence: statusStages.sequenceNumber,
      execName: execAlias.fullName,
      captainName: captainAlias.fullName,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(execAlias, eq(execAlias.id, visitRequests.assignedExecUserId))
    .leftJoin(
      captainAlias,
      eq(captainAlias.id, visitRequests.assignedCaptainUserId),
    )
    .where(eq(visitRequests.id, requestId))
    .limit(1);

  if (!reqRow) return null;

  // Need the quotation id first so we can scope items + dispatches.
  const [quoteRow] = await db
    .select({ id: quotations.id })
    .from(quotations)
    .where(eq(quotations.visitRequestId, requestId))
    .limit(1);

  let items: OrderItemRow[] = [];
  let dispatchEntries: DispatchHistoryEntry[] = [];

  if (quoteRow) {
    const itemRows = await db
      .select({
        id: quotationLineItems.id,
        productName: quotationLineItems.productName,
        productSku: quotationLineItems.productSku,
        quantityTotal: quotationLineItems.quantity,
        quantityDispatched: DISPATCHED_QTY_SQL,
        unitPricePaise: quotationLineItems.unitPricePaise,
        priority: quotationLineItems.priority,
        targetDispatchDate: quotationLineItems.targetDispatchDate,
        position: quotationLineItems.position,
      })
      .from(quotationLineItems)
      .where(eq(quotationLineItems.quotationId, quoteRow.id))
      .orderBy(asc(quotationLineItems.position));

    items = itemRows.map((r) => {
      const dispatched = Number(r.quantityDispatched);
      return {
        id: r.id,
        productName: r.productName,
        productSku: r.productSku,
        quantityTotal: r.quantityTotal,
        quantityDispatched: dispatched,
        quantityRemaining: r.quantityTotal - dispatched,
        unitPricePaise: Number(r.unitPricePaise),
        priority: r.priority,
        targetDispatchDate: r.targetDispatchDate,
      };
    });

    // Dispatches that include at least one item from this quotation.
    // We join through dispatch_items + quotation_line_items so the
    // same dispatch only appears once per (dispatch, request) — DISTINCT
    // on dispatch.id.
    const dispatchRows = await db
      .select({
        dispatchId: dispatches.id,
        createdAt: dispatches.createdAt,
        dispatchedByUserId: dispatches.dispatchedByUserId,
        dispatchedByName: users.fullName,
        notes: dispatches.notes,
      })
      .from(dispatches)
      .innerJoin(
        dispatchItems,
        eq(dispatchItems.dispatchId, dispatches.id),
      )
      .innerJoin(
        quotationLineItems,
        eq(quotationLineItems.id, dispatchItems.quotationLineItemId),
      )
      .leftJoin(users, eq(users.id, dispatches.dispatchedByUserId))
      .where(eq(quotationLineItems.quotationId, quoteRow.id))
      .groupBy(
        dispatches.id,
        dispatches.createdAt,
        dispatches.dispatchedByUserId,
        users.fullName,
        dispatches.notes,
      )
      .orderBy(asc(dispatches.createdAt));

    // Pull items + latest stage in two follow-up batched queries.
    const dispatchIds = dispatchRows.map((d) => d.dispatchId);
    if (dispatchIds.length > 0) {
      const itemRows2 = await db
        .select({
          dispatchId: dispatchItems.dispatchId,
          lineItemId: dispatchItems.quotationLineItemId,
          productName: quotationLineItems.productName,
          qty: dispatchItems.qtyInThisDispatch,
        })
        .from(dispatchItems)
        .innerJoin(
          quotationLineItems,
          eq(quotationLineItems.id, dispatchItems.quotationLineItemId),
        )
        .where(
          and(
            eq(quotationLineItems.quotationId, quoteRow.id),
            sql`${dispatchItems.dispatchId} = ANY(${sql.raw(
              `ARRAY[${dispatchIds.map((id) => `'${id}'::uuid`).join(',')}]`,
            )})`,
          ),
        );

      const stageRows = await db
        .select({
          dispatchId: dispatchStatusHistory.dispatchId,
          stage: dispatchStatusHistory.stage,
          changedAt: dispatchStatusHistory.changedAt,
        })
        .from(dispatchStatusHistory)
        .where(
          sql`${dispatchStatusHistory.dispatchId} = ANY(${sql.raw(
            `ARRAY[${dispatchIds.map((id) => `'${id}'::uuid`).join(',')}]`,
          )})`,
        );

      // Resolve latest stage per dispatch by taking the row with the
      // greatest changedAt. Mostly there will be 1–3 history rows per
      // dispatch so a JS sort is fine.
      const latestStageByDispatch = new Map<
        string,
        'created' | 'packed' | 'handed_off'
      >();
      const sortedStages = [...stageRows].sort(
        (a, b) => b.changedAt.getTime() - a.changedAt.getTime(),
      );
      for (const row of sortedStages) {
        if (!latestStageByDispatch.has(row.dispatchId)) {
          latestStageByDispatch.set(row.dispatchId, row.stage);
        }
      }

      const itemsByDispatch = new Map<
        string,
        Array<{ lineItemId: string; productName: string; qty: number }>
      >();
      for (const ir of itemRows2) {
        const list = itemsByDispatch.get(ir.dispatchId) ?? [];
        list.push({
          lineItemId: ir.lineItemId,
          productName: ir.productName,
          qty: ir.qty,
        });
        itemsByDispatch.set(ir.dispatchId, list);
      }

      dispatchEntries = dispatchRows.map((d) => ({
        dispatchId: d.dispatchId,
        createdAt: d.createdAt,
        dispatchedByUserId: d.dispatchedByUserId,
        dispatchedByName: d.dispatchedByName,
        notes: d.notes,
        currentStage: latestStageByDispatch.get(d.dispatchId) ?? 'created',
        items: itemsByDispatch.get(d.dispatchId) ?? [],
      }));
    }
  }

  return {
    request: reqRow,
    items,
    dispatches: dispatchEntries,
  };
}
