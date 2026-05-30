// HVA-199: read-side queries for the Assist domain.
//
// Scoping (locked decision):
//   - exec sees their OWN assists
//   - captain sees assists from their team (sales_executives.captain_user_id = me)
//   - admin sees all
//
// Visibility is enforced here; UI is allowed to assume rows it receives
// are in scope.

import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';
import {
  assistRequestItems,
  assistRequestStatusHistory,
  assistRequests,
  cities,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';

import type {
  AssistPriority,
  AssistStatus,
  AssistType,
} from './types';

export interface AssistRequestRow {
  id: string;
  type: AssistType;
  status: AssistStatus;
  priority: AssistPriority;
  orderNumber: string | null;
  dispatchByDate: string | null;
  message: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  exec: { userId: string; fullName: string };
  linkedRequest: {
    id: string;
    customerName: string;
    cityName: string;
    stageCode: string;
    stageName: string;
  } | null;
  itemCount: number;
}

export interface AssistRequestItem {
  id: string;
  productName: string;
  quantity: number;
}

export interface AssistRequestStatusHistoryEntry {
  id: string;
  fromStatus: AssistStatus | null;
  toStatus: AssistStatus;
  changedAt: Date;
  reason: string | null;
  changedBy: { userId: string; fullName: string } | null;
}

export interface AssistRequestDetail extends AssistRequestRow {
  items: AssistRequestItem[];
  history: AssistRequestStatusHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Visibility predicate builders
// ---------------------------------------------------------------------------

/**
 * Visibility predicate based on caller's role + identity.
 *   exec → exec_user_id = me
 *   captain → exec_user_id IN (execs whose captain_user_id = me)
 *   super_admin → no predicate (sees all)
 */
function buildVisibilityFilter(
  callerUserId: string,
  callerRole: 'sales_executive' | 'captain' | 'super_admin',
): SQL | undefined {
  if (callerRole === 'super_admin') return undefined;
  if (callerRole === 'sales_executive') {
    return eq(assistRequests.execUserId, callerUserId);
  }
  // Captain: subquery returning their team's exec ids.
  return sql`${assistRequests.execUserId} IN (
    SELECT ${salesExecutives.userId}
    FROM ${salesExecutives}
    WHERE ${salesExecutives.captainUserId} = ${callerUserId}
  )`;
}

// ---------------------------------------------------------------------------
// List loader (powers exec /assist, captain /captain/assist, admin queue)
// ---------------------------------------------------------------------------

export interface LoadAssistListArgs {
  callerUserId: string;
  callerRole: 'sales_executive' | 'captain' | 'super_admin';
  type?: AssistType;
  status?: AssistStatus;
  search?: string;
  execUserId?: string;
  cityId?: string;
  page?: number;
  pageSize?: number;
}

export interface LoadAssistListResult {
  rows: AssistRequestRow[];
  total: number;
}

const DEFAULT_PAGE_SIZE = 10;

export async function loadAssistList(
  args: LoadAssistListArgs,
): Promise<LoadAssistListResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, args.page ?? 1);
  const offset = (page - 1) * pageSize;

  const linkedRequestCity = alias(cities, 'linked_request_city');
  const linkedRequestStage = alias(statusStages, 'linked_request_stage');

  const filters: (SQL | undefined)[] = [
    buildVisibilityFilter(args.callerUserId, args.callerRole),
  ];

  if (args.type) filters.push(eq(assistRequests.type, args.type));
  if (args.status) filters.push(eq(assistRequests.status, args.status));
  if (args.execUserId) filters.push(eq(assistRequests.execUserId, args.execUserId));
  if (args.cityId) {
    // Filter by linked visit_request's city. Rows with no linked request are
    // excluded when this filter is active — matches user intent ("show me
    // assists for this city").
    filters.push(eq(linkedRequestCity.id, args.cityId));
  }
  if (args.search && args.search.trim().length > 0) {
    const q = `%${args.search.trim()}%`;
    filters.push(
      or(
        ilike(assistRequests.orderNumber, q),
        sql`EXISTS (
          SELECT 1 FROM ${assistRequestItems}
          WHERE ${assistRequestItems.assistRequestId} = ${assistRequests.id}
            AND ${assistRequestItems.productName} ILIKE ${q}
        )`,
        ilike(visitRequests.customerName, q),
        ilike(users.fullName, q),
      ),
    );
  }

  const compactFilters = filters.filter((f): f is SQL => f !== undefined);
  const whereClause =
    compactFilters.length === 0 ? undefined : and(...compactFilters);

  const baseQuery = db
    .select({
      id: assistRequests.id,
      type: assistRequests.type,
      status: assistRequests.status,
      priority: assistRequests.priority,
      orderNumber: assistRequests.orderNumber,
      dispatchByDate: assistRequests.dispatchByDate,
      message: assistRequests.message,
      rejectionReason: assistRequests.rejectionReason,
      createdAt: assistRequests.createdAt,
      updatedAt: assistRequests.updatedAt,
      execUserId: assistRequests.execUserId,
      execFullName: users.fullName,
      linkedRequestId: visitRequests.id,
      linkedCustomerName: visitRequests.customerName,
      linkedCityName: linkedRequestCity.name,
      linkedStageCode: linkedRequestStage.code,
      linkedStageName: linkedRequestStage.name,
      itemCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${assistRequestItems}
        WHERE ${assistRequestItems.assistRequestId} = ${assistRequests.id}
      )`,
    })
    .from(assistRequests)
    .leftJoin(users, eq(users.id, assistRequests.execUserId))
    .leftJoin(
      visitRequests,
      eq(visitRequests.id, assistRequests.linkedVisitRequestId),
    )
    .leftJoin(linkedRequestCity, eq(linkedRequestCity.id, visitRequests.cityId))
    .leftJoin(
      linkedRequestStage,
      eq(linkedRequestStage.id, visitRequests.statusStageId),
    );

  const [rowsRaw, totalRow] = await Promise.all([
    whereClause
      ? baseQuery
          .where(whereClause)
          .orderBy(desc(assistRequests.createdAt))
          .limit(pageSize)
          .offset(offset)
      : baseQuery
          .orderBy(desc(assistRequests.createdAt))
          .limit(pageSize)
          .offset(offset),
    whereClause
      ? db
          .select({ cnt: sql<number>`COUNT(*)::int` })
          .from(assistRequests)
          .leftJoin(
            visitRequests,
            eq(visitRequests.id, assistRequests.linkedVisitRequestId),
          )
          .leftJoin(
            linkedRequestCity,
            eq(linkedRequestCity.id, visitRequests.cityId),
          )
          .leftJoin(users, eq(users.id, assistRequests.execUserId))
          .where(whereClause)
      : db
          .select({ cnt: sql<number>`COUNT(*)::int` })
          .from(assistRequests),
  ]);

  const rows: AssistRequestRow[] = rowsRaw.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    priority: r.priority,
    orderNumber: r.orderNumber,
    dispatchByDate: r.dispatchByDate,
    message: r.message,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    exec: { userId: r.execUserId, fullName: r.execFullName ?? 'Unknown' },
    linkedRequest: r.linkedRequestId
      ? {
          id: r.linkedRequestId,
          customerName: r.linkedCustomerName ?? '',
          cityName: r.linkedCityName ?? '',
          stageCode: r.linkedStageCode ?? '',
          stageName: r.linkedStageName ?? '',
        }
      : null,
    itemCount: r.itemCount,
  }));

  return { rows, total: totalRow[0]?.cnt ?? 0 };
}

// ---------------------------------------------------------------------------
// Detail loader (one row + items + history)
// ---------------------------------------------------------------------------

export async function loadAssistDetail(args: {
  assistId: string;
  callerUserId: string;
  callerRole: 'sales_executive' | 'captain' | 'super_admin';
}): Promise<AssistRequestDetail | null> {
  const visibilityFilter = buildVisibilityFilter(
    args.callerUserId,
    args.callerRole,
  );
  const where = visibilityFilter
    ? and(eq(assistRequests.id, args.assistId), visibilityFilter)
    : eq(assistRequests.id, args.assistId);

  const linkedRequestCity = alias(cities, 'linked_request_city');
  const linkedRequestStage = alias(statusStages, 'linked_request_stage');

  const [headerRow] = await db
    .select({
      id: assistRequests.id,
      type: assistRequests.type,
      status: assistRequests.status,
      priority: assistRequests.priority,
      orderNumber: assistRequests.orderNumber,
      dispatchByDate: assistRequests.dispatchByDate,
      message: assistRequests.message,
      rejectionReason: assistRequests.rejectionReason,
      createdAt: assistRequests.createdAt,
      updatedAt: assistRequests.updatedAt,
      execUserId: assistRequests.execUserId,
      execFullName: users.fullName,
      linkedRequestId: visitRequests.id,
      linkedCustomerName: visitRequests.customerName,
      linkedCityName: linkedRequestCity.name,
      linkedStageCode: linkedRequestStage.code,
      linkedStageName: linkedRequestStage.name,
    })
    .from(assistRequests)
    .leftJoin(users, eq(users.id, assistRequests.execUserId))
    .leftJoin(
      visitRequests,
      eq(visitRequests.id, assistRequests.linkedVisitRequestId),
    )
    .leftJoin(linkedRequestCity, eq(linkedRequestCity.id, visitRequests.cityId))
    .leftJoin(
      linkedRequestStage,
      eq(linkedRequestStage.id, visitRequests.statusStageId),
    )
    .where(where)
    .limit(1);

  if (!headerRow) return null;

  const itemsRaw = await db
    .select({
      id: assistRequestItems.id,
      productName: assistRequestItems.productName,
      quantity: assistRequestItems.quantity,
    })
    .from(assistRequestItems)
    .where(eq(assistRequestItems.assistRequestId, args.assistId))
    .orderBy(asc(assistRequestItems.createdAt));

  const historyAlias = alias(users, 'history_changed_by');
  const historyRaw = await db
    .select({
      id: assistRequestStatusHistory.id,
      fromStatus: assistRequestStatusHistory.fromStatus,
      toStatus: assistRequestStatusHistory.toStatus,
      changedAt: assistRequestStatusHistory.changedAt,
      reason: assistRequestStatusHistory.reason,
      changedByUserId: assistRequestStatusHistory.changedByUserId,
      changedByFullName: historyAlias.fullName,
    })
    .from(assistRequestStatusHistory)
    .leftJoin(
      historyAlias,
      eq(historyAlias.id, assistRequestStatusHistory.changedByUserId),
    )
    .where(eq(assistRequestStatusHistory.assistRequestId, args.assistId))
    .orderBy(asc(assistRequestStatusHistory.changedAt));

  return {
    id: headerRow.id,
    type: headerRow.type,
    status: headerRow.status,
    priority: headerRow.priority,
    orderNumber: headerRow.orderNumber,
    dispatchByDate: headerRow.dispatchByDate,
    message: headerRow.message,
    rejectionReason: headerRow.rejectionReason,
    createdAt: headerRow.createdAt,
    updatedAt: headerRow.updatedAt,
    exec: {
      userId: headerRow.execUserId,
      fullName: headerRow.execFullName ?? 'Unknown',
    },
    linkedRequest: headerRow.linkedRequestId
      ? {
          id: headerRow.linkedRequestId,
          customerName: headerRow.linkedCustomerName ?? '',
          cityName: headerRow.linkedCityName ?? '',
          stageCode: headerRow.linkedStageCode ?? '',
          stageName: headerRow.linkedStageName ?? '',
        }
      : null,
    itemCount: itemsRaw.length,
    items: itemsRaw,
    history: historyRaw.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedAt: h.changedAt,
      reason: h.reason,
      changedBy: h.changedByUserId
        ? {
            userId: h.changedByUserId,
            fullName: h.changedByFullName ?? 'Unknown',
          }
        : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Open count for captain sidebar badge
// ---------------------------------------------------------------------------

export async function loadOpenAssistCountForCaptain(
  captainUserId: string,
): Promise<number> {
  const teamExecRows = await db
    .select({ userId: salesExecutives.userId })
    .from(salesExecutives)
    .where(eq(salesExecutives.captainUserId, captainUserId));
  if (teamExecRows.length === 0) return 0;
  const teamExecIds = teamExecRows.map((r) => r.userId);

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(assistRequests)
    .where(
      and(
        inArray(assistRequests.execUserId, teamExecIds),
        sql`${assistRequests.status} NOT IN ('dispatched', 'rejected')`,
      ),
    );
  return row?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Linkable visit_requests for exec's customer dropdown
// ---------------------------------------------------------------------------

export interface LinkableVisitRequestOption {
  id: string;
  customerName: string;
  cityName: string;
  stageCode: string;
  stageName: string;
}

/**
 * Search-as-you-type backing for the exec create-form's customer dropdown.
 * Scoped to visit_requests assigned to this exec, excluding cancelled +
 * terminal-positive (those are done; no point assisting on them).
 */
export async function loadLinkableVisitRequestsForExec(args: {
  execUserId: string;
  search?: string;
  limit?: number;
}): Promise<LinkableVisitRequestOption[]> {
  const limit = args.limit ?? 30;
  const filters: SQL[] = [
    eq(visitRequests.assignedExecUserId, args.execUserId),
    sql`${visitRequests.cancelledAt} IS NULL`,
    sql`${statusStages.code} != 'ORDER_EXECUTED_SUCCESSFULLY'`,
  ];
  if (args.search && args.search.trim().length > 0) {
    const q = `%${args.search.trim()}%`;
    filters.push(ilike(visitRequests.customerName, q));
  }

  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      stageCode: statusStages.code,
      stageName: statusStages.name,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(...filters))
    .orderBy(desc(visitRequests.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    cityName: r.cityName,
    stageCode: r.stageCode,
    stageName: r.stageName,
  }));
}
