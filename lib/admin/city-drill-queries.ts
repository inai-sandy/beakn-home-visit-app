import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  payments,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';

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
