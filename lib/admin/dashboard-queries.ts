// HVA-88: data loaders for the super_admin dashboard (/admin/dashboard).
//
// All metrics are GLOBAL — no captain or exec scope — because super_admin
// supervises the whole org. IST-anchored: "today" = IST date string.
//
// SSE is out of scope (Phase 2 territory per CLAUDE.md). The dashboard is
// pure SSR with `force-dynamic` so each navigation re-fetches.

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm';

import { db } from '@/db/client';
import {
  adminHelpMessages,
  captains,
  cities,
  dayPlans,
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';

const VISIT_TASK_TYPES = ['Customer home visit', 'Sales pitch', 'Outlet visit'] as const;
const ORDER_BOOK_MIN_SEQ = 6;          // ORDER_CONFIRMED and beyond
const TERMINAL_POSITIVE_CODE = 'ORDER_EXECUTED_SUCCESSFULLY';
const PENDING_APPROVAL_CODE = 'PENDING_CAPTAIN_APPROVAL';
const OTHER_CITY_NAME = 'Other';
const SUBMITTED_CODE = 'SUBMITTED';

// =============================================================================
// Types
// =============================================================================

export interface AdminGlobalMetrics {
  visitsToday: number;
  collectionsTodayPaise: number;
  completedOrdersToday: number;
  newRequestsToday: number;
  /** orders ÷ visits as a %; null when there were no visits today. */
  conversionPct: number | null;
  productiveMinutesToday: number;
}

export interface AdminRevenueSnapshot {
  receivedTodayPaise: number;
  pendingOutstandingPaise: number;
  openQuotationPaise: number;
}

export interface AdminCounts {
  openRequests: number;
  completedToday: number;
  cancelledToday: number;
  pendingCaptainApprovals: number;
}

export interface CityCard {
  cityId: string;
  cityName: string;
  isOther: boolean;
  captain: { userId: string; fullName: string } | null;
  visitsToday: number;
  collectionsTodayPaise: number;
  ordersToday: number;
  execCount: number;
  /** execs in this city who didn't submit a day plan today. */
  nonSubmitterCount: number;
}

export type AdminAlertKind = 'other_city' | 'admin_help' | 'aging_approval';

export interface AdminAlert {
  kind: AdminAlertKind;
  id: string;
  title: string;
  href: string;
  at: Date;
}

export interface FirstTimeSetupStatus {
  hasCities: boolean;
  hasCaptains: boolean;
  hasExecs: boolean;
  /** all three true → banner hides */
  ready: boolean;
}

// =============================================================================
// Global metrics (left column)
// =============================================================================

export async function loadAdminGlobalMetrics(
  istDate: string,
): Promise<AdminGlobalMetrics> {
  const [visitsRow, collectionsRow, ordersRow, newRequestsRow, productiveRow] =
    await Promise.all([
      // Visits = completed visit-typed tasks dated today.
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.taskDate, istDate),
            eq(tasks.status, 'completed'),
            inArray(
              tasks.taskType,
              VISIT_TASK_TYPES as readonly (typeof VISIT_TASK_TYPES)[number][],
            ),
          ),
        ),
      // Collections = inbound payments dated today, voided excluded.
      db
        .select({
          sum: sql<string | null>`COALESCE(SUM(${payments.amountPaise})::text, '0')`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.paymentDate, istDate),
            eq(payments.direction, 'inbound'),
            isNull(payments.voidedAt),
          ),
        ),
      // Completed orders today = transitions INTO ORDER_EXECUTED_SUCCESSFULLY
      // whose changed_at is in IST-today.
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(requestStatusHistory)
        .innerJoin(
          statusStages,
          eq(statusStages.id, requestStatusHistory.toStatusStageId),
        )
        .where(
          and(
            eq(statusStages.code, TERMINAL_POSITIVE_CODE),
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date = ${istDate}::date`,
          ),
        ),
      // New requests = visit_requests created today (IST).
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(visitRequests)
        .where(
          sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date = ${istDate}::date`,
        ),
      // Productive minutes — sum estimated minutes of completed tasks today.
      // `estimated_time` is varchar (e.g. "30min", "1hr"); parse via simple
      // regex. Treat unknown formats as 0 so a junk row can't poison the sum.
      db
        .select({
          mins: sql<number>`COALESCE(SUM(
            CASE
              WHEN ${tasks.estimatedTime} ~ '^[0-9]+min$'
                THEN CAST(REGEXP_REPLACE(${tasks.estimatedTime}, '[^0-9]', '', 'g') AS int)
              WHEN ${tasks.estimatedTime} ~ '^[0-9]+hr$'
                THEN CAST(REGEXP_REPLACE(${tasks.estimatedTime}, '[^0-9]', '', 'g') AS int) * 60
              ELSE 0
            END
          ), 0)::int`,
        })
        .from(tasks)
        .where(
          and(eq(tasks.taskDate, istDate), eq(tasks.status, 'completed')),
        ),
    ]);

  const visitsToday = visitsRow[0]?.cnt ?? 0;
  const completedOrdersToday = ordersRow[0]?.cnt ?? 0;

  return {
    visitsToday,
    collectionsTodayPaise: Number(collectionsRow[0]?.sum ?? '0'),
    completedOrdersToday,
    newRequestsToday: newRequestsRow[0]?.cnt ?? 0,
    conversionPct:
      visitsToday === 0
        ? null
        : Math.round((completedOrdersToday / visitsToday) * 100),
    productiveMinutesToday: productiveRow[0]?.mins ?? 0,
  };
}

// =============================================================================
// Revenue snapshot (left column, below metrics)
// =============================================================================

export async function loadAdminRevenueSnapshot(
  istDate: string,
): Promise<AdminRevenueSnapshot> {
  const [receivedRow, quotationRows] = await Promise.all([
    db
      .select({
        sum: sql<string | null>`COALESCE(SUM(${payments.amountPaise})::text, '0')`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.paymentDate, istDate),
          eq(payments.direction, 'inbound'),
          isNull(payments.voidedAt),
        ),
      ),
    // Per-request open quotation totals (excl. cancelled, excl. terminal-positive).
    // Pending outstanding = sum of (totalOrderValue - inbound + outbound) per
    // quoted request, clamped at 0. Open quotation = sum of totalOrderValue
    // on the same set.
    db
      .select({
        visitRequestId: quotations.visitRequestId,
        totalPaise: sql<string>`${quotations.totalOrderValuePaise}::text`,
        paidPaise: sql<string>`COALESCE((
          SELECT
            SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE 0 END)
            - SUM(CASE WHEN ${payments.direction} = 'outbound' THEN ${payments.amountPaise} ELSE 0 END)
          FROM ${payments}
          WHERE ${payments.visitRequestId} = ${quotations.visitRequestId}
            AND ${payments.voidedAt} IS NULL
        ), 0)::text`,
      })
      .from(quotations)
      .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(
        and(
          isNull(visitRequests.cancelledAt),
          ne(statusStages.code, TERMINAL_POSITIVE_CODE),
        ),
      ),
  ]);

  let pendingOutstandingPaise = 0;
  let openQuotationPaise = 0;
  for (const r of quotationRows) {
    const total = Number(r.totalPaise);
    const paid = Number(r.paidPaise);
    openQuotationPaise += total;
    const due = total - paid;
    if (due > 0) pendingOutstandingPaise += due;
  }

  return {
    receivedTodayPaise: Number(receivedRow[0]?.sum ?? '0'),
    pendingOutstandingPaise,
    openQuotationPaise,
  };
}

// =============================================================================
// Counts (left column, below revenue)
// =============================================================================

export async function loadAdminCounts(istDate: string): Promise<AdminCounts> {
  const [openRow, completedRow, cancelledRow, approvalsRow] = await Promise.all(
    [
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(visitRequests)
        .innerJoin(
          statusStages,
          eq(statusStages.id, visitRequests.statusStageId),
        )
        .where(
          and(
            isNull(visitRequests.cancelledAt),
            ne(statusStages.code, TERMINAL_POSITIVE_CODE),
          ),
        ),
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(requestStatusHistory)
        .innerJoin(
          statusStages,
          eq(statusStages.id, requestStatusHistory.toStatusStageId),
        )
        .where(
          and(
            eq(statusStages.code, TERMINAL_POSITIVE_CODE),
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date = ${istDate}::date`,
          ),
        ),
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(visitRequests)
        .where(
          and(
            isNotNull(visitRequests.cancelledAt),
            sql`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date = ${istDate}::date`,
          ),
        ),
      db
        .select({ cnt: sql<number>`COUNT(*)::int` })
        .from(visitRequests)
        .innerJoin(
          statusStages,
          eq(statusStages.id, visitRequests.statusStageId),
        )
        .where(
          and(
            eq(statusStages.code, PENDING_APPROVAL_CODE),
            isNull(visitRequests.cancelledAt),
          ),
        ),
    ],
  );

  return {
    openRequests: openRow[0]?.cnt ?? 0,
    completedToday: completedRow[0]?.cnt ?? 0,
    cancelledToday: cancelledRow[0]?.cnt ?? 0,
    pendingCaptainApprovals: approvalsRow[0]?.cnt ?? 0,
  };
}

// =============================================================================
// City cards (middle column)
// =============================================================================

export async function loadCityCards(istDate: string): Promise<CityCard[]> {
  // Load all active cities + their captain join + exec count in one pass.
  const cityRows = await db
    .select({
      cityId: cities.id,
      cityName: cities.name,
      captainUserId: cities.captainUserId,
      captainFullName: users.fullName,
    })
    .from(cities)
    .leftJoin(users, eq(users.id, cities.captainUserId))
    .where(eq(cities.isActive, true))
    .orderBy(asc(cities.name));

  const cityIds = cityRows.map((c) => c.cityId);
  if (cityIds.length === 0) return [];

  // Per-city visits / collections / orders / exec roster — one query each,
  // grouped by city. Each city's metrics are independent so the inner
  // SUM/COUNT can run in parallel via Promise.all.

  const [visitRows, collectionsRows, ordersRows, execRows, planRows] =
    await Promise.all([
      // Visits: completed visit-typed tasks today, joined to request → city.
      db
        .select({
          cityId: visitRequests.cityId,
          cnt: sql<number>`COUNT(*)::int`,
        })
        .from(tasks)
        .innerJoin(
          visitRequests,
          eq(visitRequests.id, tasks.linkRequestId),
        )
        .where(
          and(
            eq(tasks.taskDate, istDate),
            eq(tasks.status, 'completed'),
            inArray(
              tasks.taskType,
              VISIT_TASK_TYPES as readonly (typeof VISIT_TASK_TYPES)[number][],
            ),
            inArray(visitRequests.cityId, cityIds),
          ),
        )
        .groupBy(visitRequests.cityId),
      // Collections: inbound payments today, joined to request → city.
      db
        .select({
          cityId: visitRequests.cityId,
          sum: sql<string | null>`COALESCE(SUM(${payments.amountPaise})::text, '0')`,
        })
        .from(payments)
        .innerJoin(
          visitRequests,
          eq(visitRequests.id, payments.visitRequestId),
        )
        .where(
          and(
            eq(payments.paymentDate, istDate),
            eq(payments.direction, 'inbound'),
            isNull(payments.voidedAt),
            inArray(visitRequests.cityId, cityIds),
          ),
        )
        .groupBy(visitRequests.cityId),
      // Completed orders today, joined via request → city.
      db
        .select({
          cityId: visitRequests.cityId,
          cnt: sql<number>`COUNT(*)::int`,
        })
        .from(requestStatusHistory)
        .innerJoin(
          visitRequests,
          eq(visitRequests.id, requestStatusHistory.requestId),
        )
        .innerJoin(
          statusStages,
          eq(statusStages.id, requestStatusHistory.toStatusStageId),
        )
        .where(
          and(
            eq(statusStages.code, TERMINAL_POSITIVE_CODE),
            sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date = ${istDate}::date`,
            inArray(visitRequests.cityId, cityIds),
          ),
        )
        .groupBy(visitRequests.cityId),
      // Exec roster per city: a sales_executive's "city" = their captain's
      // currently-assigned city. Each captain owns at most a small set of
      // cities so duplicate-counting is rare in practice; group by both
      // captain city and exec to dedupe just in case.
      db
        .select({
          cityId: cities.id,
          execUserId: salesExecutives.userId,
        })
        .from(salesExecutives)
        .innerJoin(cities, eq(cities.captainUserId, salesExecutives.captainUserId))
        .where(
          and(eq(cities.isActive, true), inArray(cities.id, cityIds)),
        ),
      // Plans submitted today — one row per exec who submitted.
      db
        .select({
          execUserId: dayPlans.execUserId,
        })
        .from(dayPlans)
        .where(
          and(
            eq(dayPlans.planDate, istDate),
            isNotNull(dayPlans.submittedAt),
          ),
        ),
    ]);

  const visitByCity = new Map(visitRows.map((r) => [r.cityId, r.cnt]));
  const collectionByCity = new Map(
    collectionsRows.map((r) => [r.cityId, Number(r.sum ?? '0')]),
  );
  const ordersByCity = new Map(ordersRows.map((r) => [r.cityId, r.cnt]));

  // execs per city + total count
  const execsByCity = new Map<string, Set<string>>();
  for (const r of execRows) {
    const set = execsByCity.get(r.cityId) ?? new Set<string>();
    set.add(r.execUserId);
    execsByCity.set(r.cityId, set);
  }
  const submittedToday = new Set(planRows.map((r) => r.execUserId));

  return cityRows.map((c): CityCard => {
    const execs = execsByCity.get(c.cityId) ?? new Set<string>();
    let nonSubmitterCount = 0;
    for (const execId of execs) {
      if (!submittedToday.has(execId)) nonSubmitterCount += 1;
    }
    return {
      cityId: c.cityId,
      cityName: c.cityName,
      isOther: c.cityName === OTHER_CITY_NAME,
      captain: c.captainUserId
        ? { userId: c.captainUserId, fullName: c.captainFullName ?? 'Captain' }
        : null,
      visitsToday: visitByCity.get(c.cityId) ?? 0,
      collectionsTodayPaise: collectionByCity.get(c.cityId) ?? 0,
      ordersToday: ordersByCity.get(c.cityId) ?? 0,
      execCount: execs.size,
      nonSubmitterCount,
    };
  });
}

// =============================================================================
// Alerts feed (right column)
// =============================================================================

const APPROVAL_AGING_HOURS = 24;
const ALERT_FEED_LIMIT = 12;

export async function loadAdminAlerts(): Promise<AdminAlert[]> {
  const [otherCityRows, adminHelpRows, agingApprovalRows] = await Promise.all([
    // Other-city queue — SUBMITTED requests in the 'Other' city.
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        createdAt: visitRequests.createdAt,
      })
      .from(visitRequests)
      .innerJoin(cities, eq(cities.id, visitRequests.cityId))
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(
        and(
          eq(cities.name, OTHER_CITY_NAME),
          eq(statusStages.code, SUBMITTED_CODE),
          isNull(visitRequests.cancelledAt),
        ),
      )
      .orderBy(sql`${visitRequests.createdAt} DESC`)
      .limit(ALERT_FEED_LIMIT),
    // Unreplied admin help messages.
    db
      .select({
        id: adminHelpMessages.id,
        requestId: adminHelpMessages.requestId,
        customerName: visitRequests.customerName,
        sentAt: adminHelpMessages.sentAt,
      })
      .from(adminHelpMessages)
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, adminHelpMessages.requestId),
      )
      .where(isNull(adminHelpMessages.repliedAt))
      .orderBy(sql`${adminHelpMessages.sentAt} DESC`)
      .limit(ALERT_FEED_LIMIT),
    // Approvals aging > 24h. Use the same "most recent entry-into-pending"
    // semantic as the captain dashboard's loadPendingApprovals.
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        landedAt: sql<Date>`(
          SELECT rsh.changed_at FROM ${requestStatusHistory} rsh
          INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
          WHERE rsh.request_id = ${visitRequests.id}
            AND ss.code = ${PENDING_APPROVAL_CODE}
          ORDER BY rsh.transition_order DESC
          LIMIT 1
        )`,
      })
      .from(visitRequests)
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(
        and(
          eq(statusStages.code, PENDING_APPROVAL_CODE),
          isNull(visitRequests.cancelledAt),
          sql`(
            SELECT rsh.changed_at FROM ${requestStatusHistory} rsh
            INNER JOIN ${statusStages} ss ON ss.id = rsh.to_status_stage_id
            WHERE rsh.request_id = ${visitRequests.id}
              AND ss.code = ${PENDING_APPROVAL_CODE}
            ORDER BY rsh.transition_order DESC
            LIMIT 1
          ) < NOW() - INTERVAL '${sql.raw(String(APPROVAL_AGING_HOURS))} hours'`,
        ),
      )
      .limit(ALERT_FEED_LIMIT),
  ]);

  const alerts: AdminAlert[] = [];

  for (const r of otherCityRows) {
    alerts.push({
      kind: 'other_city',
      id: r.id,
      title: `Other-city request — ${r.customerName}`,
      href: '/admin/operations/other-city',
      at: r.createdAt,
    });
  }
  for (const r of adminHelpRows) {
    alerts.push({
      kind: 'admin_help',
      id: r.id,
      title: `Admin Help — ${r.customerName}`,
      href: '/admin/operations/admin-help',
      at: r.sentAt,
    });
  }
  for (const r of agingApprovalRows) {
    alerts.push({
      kind: 'aging_approval',
      id: r.id,
      title: `Approval >24h — ${r.customerName}`,
      href: `/requests/${r.id}`,
      at: r.landedAt,
    });
  }

  alerts.sort((a, b) => b.at.getTime() - a.at.getTime());
  return alerts.slice(0, ALERT_FEED_LIMIT);
}

// =============================================================================
// First-time setup status (top banner)
// =============================================================================

export async function loadFirstTimeSetupStatus(): Promise<FirstTimeSetupStatus> {
  const [citiesRow, captainsRow, execsRow] = await Promise.all([
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(cities)
      .where(eq(cities.isActive, true)),
    db.select({ cnt: sql<number>`COUNT(*)::int` }).from(captains),
    db.select({ cnt: sql<number>`COUNT(*)::int` }).from(salesExecutives),
  ]);

  const hasCities = (citiesRow[0]?.cnt ?? 0) > 0;
  const hasCaptains = (captainsRow[0]?.cnt ?? 0) > 0;
  const hasExecs = (execsRow[0]?.cnt ?? 0) > 0;
  return {
    hasCities,
    hasCaptains,
    hasExecs,
    ready: hasCities && hasCaptains && hasExecs,
  };
}

// Re-exports kept so unused-import lints don't flag the helpers above.
// (These would otherwise be dead imports — keeping them ensures future
// extensions stay convenient.)
void gte;
void lte;
void notInArray;
