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
import { loadMetrics } from '@/lib/metrics/registry';
import type { DateRange } from '@/lib/metrics/types';

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
  visits: number;
  collectedPaise: number;
  /** HVA-279: quotation value of orders confirmed in the window. */
  bookedPaise: number;
  ordersCount: number;
  newRequests: number;
  /** orders ÷ visited requests as a %; null when none visited. */
  conversionPct: number | null;
  productiveMinutes: number;
}

export interface AdminRevenueSnapshot {
  /** Window-driven: net cash received in the picked window. */
  collectedPaise: number;
  /** Snapshot as of now — ignores the window. */
  pendingOutstandingPaise: number;
  /** Snapshot as of now — ignores the window. */
  openQuotationPaise: number;
}

export interface AdminCounts {
  /** Snapshot as of now. */
  openRequests: number;
  /** Requests entering ORDER_EXECUTED_SUCCESSFULLY in the window. */
  delivered: number;
  /** Requests cancelled in the window. */
  cancelled: number;
  /** Snapshot as of now. */
  pendingCaptainApprovals: number;
}

export interface CityCard {
  cityId: string;
  cityName: string;
  isOther: boolean;
  captain: { userId: string; fullName: string } | null;
  /** Window-driven. */
  visits: number;
  /** Window-driven. */
  collectedPaise: number;
  /** Window-driven. */
  ordersCount: number;
  execCount: number;
  /** execs in this city who didn't submit a day plan TODAY — always
   *  as-of-now regardless of the window (it's an operational alert). */
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
  range: DateRange,
): Promise<AdminGlobalMetrics> {
  // Sandeep 2026-06-03: every numeric tile now flows through the SSOT
  // loaders in `lib/metrics/*`. The shape of `AdminGlobalMetrics` is
  // preserved so the admin tile components don't change, but the
  // underlying formulas are now identical to the captain + exec
  // surfaces — same orders semantic (ORDER_CONFIRMED, not the legacy
  // TERMINAL_POSITIVE_CODE), same IST-cast on every timestamptz, same
  // attribution rule (visit_request.assigned_exec_user_id).
  const m = await loadMetrics(
    [
      'visits',
      'revenue',
      'orders_value',
      'orders_count',
      'new_requests',
      'conversion_pct',
      'productive_minutes',
    ],
    {},
    range,
  );

  return {
    visits: m.visits ?? 0,
    collectedPaise: m.revenue ?? 0,
    bookedPaise: m.orders_value ?? 0,
    ordersCount: m.orders_count ?? 0,
    newRequests: m.new_requests ?? 0,
    conversionPct: m.conversion_pct,
    productiveMinutes: m.productive_minutes ?? 0,
  };
}

// =============================================================================
// Revenue snapshot (left column, below metrics)
// =============================================================================

export async function loadAdminRevenueSnapshot(
  range: DateRange,
): Promise<AdminRevenueSnapshot> {
  // Sandeep 2026-06-03 SSOT refactor:
  //   - receivedTodayPaise → SSOT `revenue` loader (identical formula
  //     to captain + exec revenue tiles).
  //   - pendingOutstandingPaise → SSOT `outstanding` loader (identical
  //     formula to captain + exec outstanding tiles; Bug 7 semantics —
  //     includes executed-but-unpaid).
  //   - openQuotationPaise stays bespoke because it has no
  //     cross-portal twin: it's the face value of all quotations on
  //     non-cancelled requests, paid or not. Admin-only tile.
  const [{ revenue, outstanding }, quotationRows] = await Promise.all([
    loadMetrics(['revenue', 'outstanding'], {}, range),
    db
      .select({
        totalPaise: sql<string>`${quotations.totalOrderValuePaise}::text`,
      })
      .from(quotations)
      .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
      .where(isNull(visitRequests.cancelledAt)),
  ]);

  let openQuotationPaise = 0;
  for (const r of quotationRows) openQuotationPaise += Number(r.totalPaise);

  return {
    collectedPaise: revenue ?? 0,
    pendingOutstandingPaise: outstanding ?? 0,
    openQuotationPaise,
  };
}

// =============================================================================
// Counts (left column, below revenue)
// =============================================================================

export async function loadAdminCounts(range: DateRange): Promise<AdminCounts> {
  // Sandeep 2026-06-03 SSOT refactor:
  //   - cancelledToday → SSOT `cancelled_requests` loader.
  //   - pendingCaptainApprovals → SSOT `pending_approvals` loader.
  //   - completedToday stays bespoke. Admin-only label; legacy
  //     semantic = transitions INTO ORDER_EXECUTED_SUCCESSFULLY today
  //     (a fulfillment milestone, separate from the `orders_count`
  //     SSOT which counts ORDER_CONFIRMED).
  //   - openRequests stays bespoke. Pipeline snapshot — no
  //     cross-portal twin.
  const [
    { cancelled_requests: cancelled, pending_approvals: approvals },
    openRow,
    completedRow,
  ] = await Promise.all([
    loadMetrics(['cancelled_requests', 'pending_approvals'], {}, range),
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
      .select({
        cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
      })
      .from(requestStatusHistory)
      .innerJoin(
        statusStages,
        eq(statusStages.id, requestStatusHistory.toStatusStageId),
      )
      .where(
        and(
          eq(statusStages.code, TERMINAL_POSITIVE_CODE),
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date >= ${range.fromDate}`,
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date <= ${range.toDate}`,
        ),
      ),
  ]);

  return {
    openRequests: openRow[0]?.cnt ?? 0,
    delivered: completedRow[0]?.cnt ?? 0,
    cancelled: cancelled ?? 0,
    pendingCaptainApprovals: approvals ?? 0,
  };
}

// =============================================================================
// City cards (middle column)
// =============================================================================

export async function loadCityCards(
  range: DateRange,
  /** non-submitter check is ALWAYS today (operational alert). */
  istToday: string,
): Promise<CityCard[]> {
  // Sandeep 2026-06-03 SSOT follow-up: every per-city tile flows through
  // the SSOT loaders too — same orders semantic (ORDER_CONFIRMED), same
  // visits semantic (sales_executives.city_id → tasks by exec_user_id),
  // same revenue formula. Captain dashboard scoped to a city's captain
  // and admin city card for that city will now report identical numbers.
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

  if (cityRows.length === 0) return [];

  const cityIds = cityRows.map((c) => c.cityId);

  const [perCityMetrics, execRows, planRows] = await Promise.all([
    Promise.all(
      cityRows.map(async (c) => {
        const m = await loadMetrics(
          ['revenue', 'visits', 'orders_count'],
          { cityId: c.cityId },
          range,
        );
        return { cityId: c.cityId, ...m };
      }),
    ),
    db
      .select({
        cityId: salesExecutives.cityId,
        execUserId: salesExecutives.userId,
      })
      .from(salesExecutives)
      .where(inArray(salesExecutives.cityId, cityIds)),
    db
      .select({ execUserId: dayPlans.execUserId })
      .from(dayPlans)
      .where(
        and(
          eq(dayPlans.planDate, istToday),
          isNotNull(dayPlans.submittedAt),
        ),
      ),
  ]);

  const metricsByCity = new Map(perCityMetrics.map((r) => [r.cityId, r]));

  // execs per city + total count
  const execsByCity = new Map<string, Set<string>>();
  for (const r of execRows) {
    if (!r.cityId) continue;
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
    const m = metricsByCity.get(c.cityId);
    return {
      cityId: c.cityId,
      cityName: c.cityName,
      isOther: c.cityName === OTHER_CITY_NAME,
      captain: c.captainUserId
        ? { userId: c.captainUserId, fullName: c.captainFullName ?? 'Captain' }
        : null,
      visits: m?.visits ?? 0,
      collectedPaise: m?.revenue ?? 0,
      ordersCount: m?.orders_count ?? 0,
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
