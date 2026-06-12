import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';
import {
  loadExecStatusesByCityId,
  loadPendingApprovalsForCityIds,
  loadPendingCollectionsForExecIds,
  type DateFilter,
  type PendingApprovalRow,
  type PendingCollectionsSummary,
  type TeamExecStatus,
} from '@/lib/captain/dashboard-queries';
import { loadMetrics } from '@/lib/metrics/registry';

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

  // BUG 8 (2026-06-03): count execs whose city_id = THIS city. Was
  // previously counting all execs of the captain — over-counted when
  // the captain owned multiple cities (each city showed the same
  // total team size).
  let execCount = 0;
  const [c] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(salesExecutives)
    .where(eq(salesExecutives.cityId, cityId));
  execCount = c?.cnt ?? 0;

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

/** Sales execs assigned to this city (BUG 8 2026-06-03 — was previously
 *  the captain's full team across all their cities; now narrowed via
 *  sales_executives.city_id = this city). Returns active first, then
 *  inactive, both alphabetised. */
export async function loadCityExecs(
  cityId: string,
  istToday: string,
): Promise<CityExecRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      isActive: users.isActive,
      tasksToday: sql<number>`(
        SELECT COUNT(*)::int FROM ${tasks}
        WHERE ${tasks.execUserId} = ${users}.id
          AND ${tasks.taskDate} = ${istToday}
      )`,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(eq(salesExecutives.cityId, cityId))
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
      // Sandeep 2026-06-03: outstanding subtracts NET paid (inbound −
      // outbound). Previously only inbound was summed, so a refund
      // returned to "phantom paid" status and the per-row outstanding
      // under-counted.
      outstandingPaise: sql<number>`(
        COALESCE((
          SELECT MAX(total_order_value_paise)
          FROM quotations
          WHERE quotations.visit_request_id = ${visitRequests}.id
        ), 0)
        -
        COALESCE((
          SELECT SUM(
            CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
                 WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
                 ELSE 0 END
          )::int
          FROM ${payments}
          WHERE ${payments.visitRequestId} = ${visitRequests}.id
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
  // Sandeep 2026-06-03 SSOT follow-up: window-scoped city metrics flow
  // through the same loaders as everything else. Same formula a captain
  // sees on their dashboard for the same window, by construction.
  const m = await loadMetrics(
    [
      'visits',
      'revenue',
      'orders_count',
      'quotations_count',
      'new_requests',
      'conversion_pct',
    ],
    { cityId },
    { fromDate, toDate },
  );

  return {
    fromDate,
    toDate,
    visitsCount: m.visits ?? 0,
    collectionsPaise: m.revenue ?? 0,
    ordersCount: m.orders_count ?? 0,
    quotationsCount: m.quotations_count ?? 0,
    newRequestsCount: m.new_requests ?? 0,
    conversionPct: m.conversion_pct,
  };
}

// =============================================================================
// Captain-level surfaces scoped to a single city
// =============================================================================
//
// Sandeep 2026-06-03: the admin city drill should look like a captain
// dashboard scoped to one city — without escaping into the captain
// shell. These three functions thinly wrap the captain loaders with a
// single-city scope so the same `<PendingApprovalsCard>`,
// `<PendingCollectionsCard>`, and `<ExecStatusList>` components from
// the captain dashboard render unchanged on the admin city page.
//
// The captain loaders themselves were refactored to expose
// city-scoped / exec-id-scoped variants for exactly this use case.

/** Pending approvals scoped to a single city. */
export async function loadCityPendingApprovals(
  cityId: string,
  filter: DateFilter,
): Promise<{
  totalCount: number;
  staleCount: number;
  topFive: PendingApprovalRow[];
}> {
  return loadPendingApprovalsForCityIds([cityId], filter);
}

/** Pending collections scoped to a single city's execs. Resolves
 *  execs via `sales_executives.city_id = cityId` (post Bug 8). */
export async function loadCityPendingCollections(
  cityId: string,
  filter: DateFilter,
): Promise<PendingCollectionsSummary> {
  const execs = await db
    .select({ userId: salesExecutives.userId })
    .from(salesExecutives)
    .where(eq(salesExecutives.cityId, cityId));
  return loadPendingCollectionsForExecIds(execs.map((e) => e.userId), filter);
}

/** Per-exec status list scoped to a single city's execs. */
export async function loadCityExecStatuses(
  cityId: string,
  filter: DateFilter,
): Promise<TeamExecStatus[]> {
  return loadExecStatusesByCityId(cityId, filter);
}
