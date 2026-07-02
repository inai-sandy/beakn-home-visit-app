import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { getConfig } from '@/lib/config';

// =============================================================================
// Exec monthly target — progress calculator
// =============================================================================
//
// One per-exec result reports two parallel meters against the same
// `monthly_exec_target_paise` config value:
//
//   1. orders_paise — sum of `quotations.total_order_value_paise` for
//      visit_requests that entered ORDER_CONFIRMED inside the month.
//      Attribution: visit_requests.assigned_exec_user_id at the moment
//      of the transition (Sandeep's confirmation 2026-06-02 + the
//      saved attribution-vs-action-taker principle).
//
//   2. revenue_paise — sum of inbound payments.amount_paise for
//      payments whose payment_date falls within the month.
//      Attribution: visit_requests.assigned_exec_user_id (NOT
//      payments.recorded_by_user_id — captains often record on behalf
//      of execs; the deal-owner gets the credit).
//
// Both queries use the same `assigned_exec_user_id` snapshot. A request
// reassigned mid-month: if it confirms after reassignment, the new
// exec gets the order credit; payments after reassignment credit the
// new exec too (because the lookup is on the request's current
// assigned exec at query time). Acceptable for v1; matches leaderboard
// semantics + Sandeep's "Arjun" answer (current assignee gets credit).
//
// IST timezone: month boundaries computed in IST via the same trick
// the leaderboard uses (cast `submitted_at` / `changed_at` /
// `payment_date` `AT TIME ZONE 'Asia/Kolkata'`).
// =============================================================================

export interface ExecTargetProgress {
  execUserId: string;
  fullName: string;
  /** Cities served by this exec's captain (display only). */
  cityNames: string[];
  /** Target value per exec (paise) — same across all execs. */
  targetPaise: number;
  /** Orders confirmed in the month, in paise. */
  ordersPaise: number;
  /** Inbound revenue collected in the month, in paise. */
  revenuePaise: number;
  /** 0..1+ ratio of orders progress (can exceed 1 when over-target). */
  ordersRatio: number;
  /** 0..1+ ratio of revenue progress. */
  revenueRatio: number;
  /** Average of the two ratios — used to rank in the arena view. */
  combinedRatio: number;
}

export interface TargetMonthWindow {
  monthStart: string; // YYYY-MM-DD (IST first day of month)
  monthEnd: string; // YYYY-MM-DD (IST last day of month, inclusive)
  daysLeft: number; // days from today (inclusive) to monthEnd
  daysElapsed: number; // days from monthStart to today (inclusive)
  monthLabel: string; // e.g. "June 2026"
}

/** Calendar-month window in IST. Used for the calendar where today
 *  lives. `daysLeft` counts inclusive of today; `daysElapsed` counts
 *  inclusive of monthStart. */
export function getCurrentMonthWindow(now: Date = new Date()): TargetMonthWindow {
  // IST calendar fields.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '2026');
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? '1');

  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  // Last day of month: roll forward 1 month then subtract 1 day via UTC
  // math (calendar-month length doesn't shift across timezones at the
  // day level).
  const next = new Date(Date.UTC(y, m, 1));
  next.setUTCDate(next.getUTCDate() - 1);
  const lastDay = next.getUTCDate();
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const daysLeft = Math.max(0, lastDay - d + 1);
  const daysElapsed = d;

  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(
    'en-IN',
    { year: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' },
  );

  return { monthStart, monthEnd, daysLeft, daysElapsed, monthLabel };
}

/** Resolve the configured target value. */
export async function loadMonthlyTargetPaise(): Promise<number> {
  return await getConfig('monthly_exec_target_paise');
}

const ORDER_CONFIRMED_CODE = 'ORDER_CONFIRMED';

/** Per-exec progress for the given month window. Returns one row per
 *  ACTIVE exec — even execs with zero activity (so the captain/admin
 *  arena view shows a complete roster). Sorted by combinedRatio desc
 *  for direct render. */
export async function loadAllExecTargetProgress(
  window: TargetMonthWindow,
  targetPaise: number,
  opts: { captainUserId?: string } = {},
): Promise<ExecTargetProgress[]> {
  // Step 1: all active execs (optionally filtered to a captain's team).
  const execBase = db
    .select({
      execUserId: users.id,
      fullName: users.fullName,
      captainUserId: salesExecutives.captainUserId,
      // BUG 8 (2026-06-03): exec belongs to ONE city. Pull the city
      // assignment directly here so the assembled row's `cityNames`
      // shows that single city, not the captain's full city list.
      cityId: salesExecutives.cityId,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(users.isActive, true),
        opts.captainUserId
          ? eq(salesExecutives.captainUserId, opts.captainUserId)
          : sql`true`,
      ),
    )
    .orderBy(asc(users.fullName));
  const execs = await execBase;

  if (execs.length === 0) return [];

  // Step 2: orders confirmed in the month, attributed to the assigned
  // exec at the time of the transition. We approximate via the request's
  // CURRENT assigned_exec_user_id (the leaderboard does the same — the
  // semantic is "the deal-owner of record"). Sums total_order_value_paise
  // from the quotation.
  //
  // CRITICAL: status_history can have multiple ORDER_CONFIRMED rows for
  // the same request (rollback + re-confirm in the same month). A
  // naive JOIN of status_history → visit_requests → quotations would
  // double-count the quotation value in SUM. We pre-filter to DISTINCT
  // request_ids via a subquery so each confirmed request contributes
  // exactly once. Same bug class as the leaderboard `COUNT(DISTINCT
  // request_id)` fix shipped 2026-06-01 — distinct flavoured for
  // SUM(value) instead of COUNT.
  const confirmedRequestSubquery = sql`(
    SELECT DISTINCT ${requestStatusHistory.requestId} AS request_id
    FROM ${requestStatusHistory}
    INNER JOIN ${statusStages}
      ON ${statusStages.id} = ${requestStatusHistory.toStatusStageId}
    WHERE ${statusStages.code} = ${ORDER_CONFIRMED_CODE}
      AND (${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date
          BETWEEN ${window.monthStart}::date AND ${window.monthEnd}::date
  )`;
  const orderRows = await db
    .select({
      execUserId: visitRequests.assignedExecUserId,
      totalPaise: sql<number>`COALESCE(SUM(${quotations.totalOrderValuePaise}), 0)::bigint`,
    })
    .from(sql`${confirmedRequestSubquery} AS confirmed`)
    .innerJoin(visitRequests, sql`${visitRequests.id} = confirmed.request_id`)
    .innerJoin(
      quotations,
      and(
        eq(quotations.visitRequestId, visitRequests.id),
        // HVA-281: order value comes from CartPlus actuals only.
        eq(quotations.source, 'portal'),
      ),
    )
    .where(sql`${visitRequests.assignedExecUserId} IS NOT NULL`)
    .groupBy(visitRequests.assignedExecUserId);

  // Step 3: revenue collected in the month, attributed to the request's
  // assigned exec (NOT payments.recorded_by_user_id — attribution
  // principle).
  const revRows = await db
    // Sandeep 2026-06-03: revenue = net cash (inbound − outbound).
    .select({
      execUserId: visitRequests.assignedExecUserId,
      totalPaise: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, payments.visitRequestId),
    )
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, window.monthStart),
        lte(payments.paymentDate, window.monthEnd),
        sql`${visitRequests.assignedExecUserId} IS NOT NULL`,
      ),
    )
    .groupBy(visitRequests.assignedExecUserId);

  // ::bigint sums come back from postgres-js as strings — coerce to number.
  const ordersByExec = new Map<string, number>();
  for (const r of orderRows) {
    if (r.execUserId) ordersByExec.set(r.execUserId, Number(r.totalPaise ?? 0));
  }
  const revByExec = new Map<string, number>();
  for (const r of revRows) {
    if (r.execUserId) revByExec.set(r.execUserId, Number(r.totalPaise ?? 0));
  }

  // Step 4: per-exec city name lookup. BUG 8 (2026-06-03): each exec
  // is in exactly ONE city, looked up via sales_executives.city_id.
  // Was previously the captain's full city list, which over-stated
  // each exec's coverage on the leaderboard.
  const cityIds = Array.from(
    new Set(execs.map((e) => e.cityId).filter((x): x is string => !!x)),
  );
  const cityNameById = new Map<string, string>();
  if (cityIds.length > 0) {
    const cityRows = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(inArray(cities.id, cityIds));
    for (const row of cityRows) {
      cityNameById.set(row.id, row.name);
    }
  }

  // Step 5: assemble + rank.
  const safeTarget = Math.max(1, targetPaise); // avoid div-by-zero
  const rows: ExecTargetProgress[] = execs.map((e) => {
    const ordersPaise = ordersByExec.get(e.execUserId) ?? 0;
    const revenuePaise = revByExec.get(e.execUserId) ?? 0;
    const ordersRatio = ordersPaise / safeTarget;
    const revenueRatio = revenuePaise / safeTarget;
    return {
      execUserId: e.execUserId,
      fullName: e.fullName ?? '(unnamed)',
      // BUG 8: single city per exec; empty array when cityId is NULL
      // (legacy rows where the multi-city captain backfill couldn't
      // decide a default).
      cityNames:
        e.cityId && cityNameById.has(e.cityId)
          ? [cityNameById.get(e.cityId)!]
          : [],
      targetPaise,
      ordersPaise,
      revenuePaise,
      ordersRatio,
      revenueRatio,
      combinedRatio: (ordersRatio + revenueRatio) / 2,
    };
  });

  rows.sort((a, b) => {
    if (b.combinedRatio !== a.combinedRatio) {
      return b.combinedRatio - a.combinedRatio;
    }
    return a.fullName.localeCompare(b.fullName);
  });
  return rows;
}

/** Single-exec progress fetch — for the exec dashboard. Convenience
 *  wrapper that runs the bulk query and filters to one row. */
export async function loadOneExecTargetProgress(
  execUserId: string,
  window: TargetMonthWindow,
  targetPaise: number,
): Promise<ExecTargetProgress | null> {
  // Direct narrow query — avoids the all-execs bulk path.
  // Same DISTINCT-on-request_id subquery pattern as the bulk version
  // to avoid double-counting when a request rolls back and re-confirms
  // in the same month.
  const confirmedRequestSubquery = sql`(
    SELECT DISTINCT ${requestStatusHistory.requestId} AS request_id
    FROM ${requestStatusHistory}
    INNER JOIN ${statusStages}
      ON ${statusStages.id} = ${requestStatusHistory.toStatusStageId}
    WHERE ${statusStages.code} = ${ORDER_CONFIRMED_CODE}
      AND (${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date
          BETWEEN ${window.monthStart}::date AND ${window.monthEnd}::date
  )`;
  const [orderRow] = await db
    .select({
      totalPaise: sql<number>`COALESCE(SUM(${quotations.totalOrderValuePaise}), 0)::bigint`,
    })
    .from(sql`${confirmedRequestSubquery} AS confirmed`)
    .innerJoin(visitRequests, sql`${visitRequests.id} = confirmed.request_id`)
    .innerJoin(
      quotations,
      and(
        eq(quotations.visitRequestId, visitRequests.id),
        // HVA-281: order value comes from CartPlus actuals only.
        eq(quotations.source, 'portal'),
      ),
    )
    .where(eq(visitRequests.assignedExecUserId, execUserId));

  // Sandeep 2026-06-03: revenue = net cash (inbound − outbound).
  const [revRow] = await db
    .select({
      totalPaise: sql<number>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      ), 0)::bigint`,
    })
    .from(payments)
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, payments.visitRequestId),
    )
    .where(
      and(
        isNull(payments.voidedAt),
        eq(visitRequests.assignedExecUserId, execUserId),
        gte(payments.paymentDate, window.monthStart),
        lte(payments.paymentDate, window.monthEnd),
      ),
    );

  const [identityRow] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, execUserId))
    .limit(1);

  if (!identityRow) return null;

  const ordersPaise = Number(orderRow?.totalPaise ?? 0);
  const revenuePaise = Number(revRow?.totalPaise ?? 0);
  const safeTarget = Math.max(1, targetPaise);
  const ordersRatio = ordersPaise / safeTarget;
  const revenueRatio = revenuePaise / safeTarget;
  return {
    execUserId,
    fullName: identityRow.fullName ?? '(unnamed)',
    cityNames: [],
    targetPaise,
    ordersPaise,
    revenuePaise,
    ordersRatio,
    revenueRatio,
    combinedRatio: (ordersRatio + revenueRatio) / 2,
  };
}
