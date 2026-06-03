import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';

const VISIT_TASK_TYPES = [
  'Customer home visit',
  'Sales pitch',
  'Outlet visit',
] as const;
const ORDER_CONFIRMED_CODE = 'ORDER_CONFIRMED';

// =============================================================================
// HVA-117 follow-up: admin city drill page data loaders
// =============================================================================
//
// The dashboard CityCard already gives us today's pulse (visits /
// collections / orders / nonSubmitterCount). The drill page needs more
// depth without re-rendering the captain portal:
//
//   - city header (name, state, captain, exec count)
//   - exec roster (name + role + today's task count)
//   - open requests (not-cancelled, not-terminal-positive) — paginated
//
// All loaders accept a cityId string; the admin caller already gates
// on super_admin role, so no per-row authz here.
// =============================================================================

export interface CityHeader {
  cityId: string;
  cityName: string;
  state: string | null;
  isOther: boolean;
  captain: { userId: string; fullName: string; email: string | null } | null;
  execCount: number;
}

const OTHER_CITY_NAME = 'Other';

export async function loadCityHeader(
  cityId: string,
): Promise<CityHeader | null> {
  const [row] = await db
    .select({
      cityId: cities.id,
      cityName: cities.name,
      state: cities.state,
      captainUserId: cities.captainUserId,
      captainName: users.fullName,
      captainEmail: users.email,
    })
    .from(cities)
    .leftJoin(users, eq(users.id, cities.captainUserId))
    .where(eq(cities.id, cityId))
    .limit(1);

  if (!row) return null;

  let execCount = 0;
  if (row.captainUserId) {
    const [c] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(salesExecutives)
      .where(eq(salesExecutives.captainUserId, row.captainUserId));
    execCount = c?.cnt ?? 0;
  }

  return {
    cityId: row.cityId,
    cityName: row.cityName,
    state: row.state ?? null,
    isOther: row.cityName === OTHER_CITY_NAME,
    captain: row.captainUserId
      ? {
          userId: row.captainUserId,
          fullName: row.captainName ?? '(unnamed)',
          email: row.captainEmail ?? null,
        }
      : null,
    execCount,
  };
}

export interface CityExecRow {
  userId: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  tasksToday: number;
}

/** Sales execs for the city's captain. The schema models execs against
 *  captain_user_id (NOT city), so we follow the join: city → captain →
 *  sales_executives. Returns active first, then inactive, both
 *  alphabetised. */
export async function loadCityExecs(
  cityId: string,
  istToday: string,
): Promise<CityExecRow[]> {
  // Captain for this city.
  const [cityRow] = await db
    .select({ captainUserId: cities.captainUserId })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);

  if (!cityRow?.captainUserId) return [];

  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      isActive: users.isActive,
      tasksToday: sql<number>`(
        SELECT COUNT(*)::int FROM ${tasks}
        WHERE ${tasks.execUserId} = ${users.id}
          AND ${tasks.taskDate} = ${istToday}
      )`,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(eq(salesExecutives.captainUserId, cityRow.captainUserId))
    .orderBy(desc(users.isActive), asc(users.fullName));

  return rows.map((r) => ({
    userId: r.userId,
    fullName: r.fullName ?? '(unnamed)',
    email: r.email ?? null,
    isActive: r.isActive,
    tasksToday: r.tasksToday ?? 0,
  }));
}

export interface CityRequestRow {
  id: string;
  customerName: string;
  customerPhone: string;
  createdAt: Date;
  statusStageCode: string;
  statusStageName: string;
  assignedExecName: string | null;
  outstandingPaise: number;
}

/** Open visit requests in the city — not cancelled, not at the terminal
 *  ORDER_EXECUTED_SUCCESSFULLY stage. Newest first, capped at 50 (admin
 *  can navigate to the captain Requests list for the full set). */
export async function loadCityOpenRequests(
  cityId: string,
): Promise<CityRequestRow[]> {
  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      createdAt: visitRequests.createdAt,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
      assignedExecName: users.fullName,
      outstandingPaise: sql<number>`(
        COALESCE((
          SELECT MAX(total_order_value_paise)
          FROM quotations
          WHERE quotations.visit_request_id = ${visitRequests.id}
        ), 0)
        -
        COALESCE((
          SELECT SUM(${payments.amountPaise})::int
          FROM ${payments}
          WHERE ${payments.visitRequestId} = ${visitRequests.id}
            AND ${payments.direction} = 'inbound'
            AND ${payments.voidedAt} IS NULL
        ), 0)
      )::int`,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .where(
      and(
        eq(visitRequests.cityId, cityId),
        isNull(visitRequests.cancelledAt),
        ne(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'),
      ),
    )
    .orderBy(desc(visitRequests.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    createdAt: r.createdAt,
    statusStageCode: r.statusStageCode,
    statusStageName: r.statusStageName,
    assignedExecName: r.assignedExecName ?? null,
    outstandingPaise: r.outstandingPaise ?? 0,
  }));
}

// =============================================================================
// Window-scoped city metrics — for the admin city drill date picker
// =============================================================================
//
// Sandeep 2026-06-03: admin needs to view a city's metrics over a date
// range (e.g. "Hyderabad May 5 → June 3") directly inside the admin
// shell — without escaping into the captain portal. This loader is the
// data backbone for that filter.
//
// Calc-integrity discipline (saved memory `calc-integrity-non-negotiable`):
//   * Orders + quotations COUNT(DISTINCT request_id) so a rollback +
//     re-confirm within the window doesn't inflate the count.
//   * All timestamptz date casts wrapped in
//     `AT TIME ZONE 'Asia/Kolkata'` so the window boundary respects
//     IST midnight, not UTC.
//   * Inbound payments only (voidedAt IS NULL).
//   * Tasks/payments columns that are already plain `date` get a
//     direct `gte/lte` comparison; no TZ wrap needed.
//
// One round-trip, six parallel sub-queries.

export interface CityWindowMetrics {
  fromDate: string;
  toDate: string;
  visitsCount: number;
  collectionsPaise: number;
  ordersCount: number;
  quotationsCount: number;
  newRequestsCount: number;
  /** orders / visits as percent; null when no visits in window. */
  conversionPct: number | null;
}

export async function loadCityMetricsForWindow(
  cityId: string,
  fromDate: string,
  toDate: string,
): Promise<CityWindowMetrics> {
  const [
    visitsRow,
    collectionsRow,
    ordersRow,
    quotationsRow,
    newReqRow,
  ] = await Promise.all([
    // Visits = completed visit-type tasks in window, for execs whose
    // captain owns this city. Tasks don't carry city_id directly; the
    // captain-to-city link is the bridge.
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(tasks)
      .innerJoin(
        salesExecutives,
        eq(salesExecutives.userId, tasks.execUserId),
      )
      .innerJoin(
        cities,
        eq(cities.captainUserId, salesExecutives.captainUserId),
      )
      .where(
        and(
          eq(cities.id, cityId),
          inArray(
            tasks.taskType,
            VISIT_TASK_TYPES as readonly (typeof VISIT_TASK_TYPES)[number][],
          ),
          eq(tasks.status, 'completed'),
          gte(tasks.taskDate, fromDate),
          lte(tasks.taskDate, toDate),
        ),
      ),
    // Inbound payments in window for requests in this city.
    db
      .select({
        sum: sql<string | null>`COALESCE(SUM(${payments.amountPaise})::text, '0')`,
      })
      .from(payments)
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, payments.visitRequestId),
      )
      .where(
        and(
          eq(visitRequests.cityId, cityId),
          eq(payments.direction, 'inbound'),
          isNull(payments.voidedAt),
          gte(payments.paymentDate, fromDate),
          lte(payments.paymentDate, toDate),
        ),
      ),
    // ORDER_CONFIRMED transitions in window for requests in this city.
    // DISTINCT request_id so rollback+reconfirm doesn't double-count.
    db
      .select({
        cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
      })
      .from(requestStatusHistory)
      .innerJoin(
        statusStages,
        eq(statusStages.id, requestStatusHistory.toStatusStageId),
      )
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, requestStatusHistory.requestId),
      )
      .where(
        and(
          eq(visitRequests.cityId, cityId),
          eq(statusStages.code, ORDER_CONFIRMED_CODE),
          gte(
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            fromDate,
          ),
          lte(
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            toDate,
          ),
        ),
      ),
    // Quotations submitted in window for requests in this city.
    // quotations are 1:1 with visit_request (UNIQUE FK), so no
    // DISTINCT needed — but the IST timezone cast IS needed.
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(quotations)
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, quotations.visitRequestId),
      )
      .where(
        and(
          eq(visitRequests.cityId, cityId),
          gte(
            sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            fromDate,
          ),
          lte(
            sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            toDate,
          ),
        ),
      ),
    // New requests = visit_requests.created_at in window in this city.
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.cityId, cityId),
          gte(
            sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            fromDate,
          ),
          lte(
            sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
            toDate,
          ),
        ),
      ),
  ]);

  const visitsCount = visitsRow[0]?.cnt ?? 0;
  const ordersCount = ordersRow[0]?.cnt ?? 0;

  return {
    fromDate,
    toDate,
    visitsCount,
    collectionsPaise: Number(collectionsRow[0]?.sum ?? '0'),
    ordersCount,
    quotationsCount: quotationsRow[0]?.cnt ?? 0,
    newRequestsCount: newReqRow[0]?.cnt ?? 0,
    conversionPct:
      visitsCount === 0
        ? null
        : Math.round((ordersCount / visitsCount) * 100),
  };
}
