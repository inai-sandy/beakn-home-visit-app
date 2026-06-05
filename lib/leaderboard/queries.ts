import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

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
import { getConfig } from '@/lib/config';

import { loadStreaksForExecs } from './streak';

// =============================================================================
// HVA-201: leaderboard data layer
// =============================================================================
//
// loadLeaderboard({ metric, window }) returns every active sales executive
// ranked by the chosen metric over the chosen IST time window. All execs
// are included even with zero activity (they sit at the bottom).
//
// Six base metrics + a composite "Beakn Score" blended from all six using
// admin-configurable weights (config.leaderboard_composite_weights). Each
// metric value is normalised (value ÷ max-across-execs × 100) before the
// weighted sum, so metrics on different scales (₹ vs counts vs %) compose
// cleanly.
//
// Tie-break chain: same-rank ties broken by revenue desc → conversion%
// desc → visits desc → fullName asc.
// =============================================================================

export type LeaderboardMetric =
  | 'composite'
  | 'revenue'
  | 'visits'
  | 'quotations'
  | 'orders'
  | 'conversion_pct'
  | 'task_completion_pct';

/** Either a single date OR a from→to range; mirrors DateFilter in lib/captain. */
export type LeaderboardWindow =
  | { mode: 'single'; date: string }
  | { mode: 'range'; from: string; to: string };

export interface LeaderboardRow {
  execUserId: string;
  fullName: string;
  /** First city (alphabetical) of the exec's captain. Null if captain owns no cities. */
  cityName: string | null;
  captainName: string | null;
  /** Value for the *active* metric. Null for percentages with zero denominator. */
  metricValue: number | null;
  /** Composite Beakn Score 0–100. Always computed (used for tie-break when metric ≠ composite). */
  compositeScore: number;
  /** 1-based; ties share the same rank. */
  rank: number;
  /** HVA-201 delta: change vs the prior comparable period (same length,
   *  ending immediately before this window). Positive = climbed; negative
   *  = dropped; 0 = unchanged; null = new (not in prior period). */
  rankDelta: number | null;
  /** HVA-201 streak: consecutive IST days (ending yesterday) with at
   *  least one VISIT_COMPLETED or ORDER_CONFIRMED transition assigned
   *  to this exec. 0 = no activity yesterday. Computed by
   *  `loadStreaksForExecs` and merged into rows in `loadLeaderboard`. */
  streakDays: number;
}

export interface LoadLeaderboardArgs {
  metric: LeaderboardMetric;
  window: LeaderboardWindow;
}

// ---------------------------------------------------------------------------
// Window resolution — IST midnight boundaries
// ---------------------------------------------------------------------------

/** Translate the window spec into inclusive IST date strings. Pure logic;
 *  no DB call. */
function resolveWindow(windowSpec: LeaderboardWindow): {
  fromDate: string;
  toDate: string;
} {
  if (windowSpec.mode === 'single') {
    return { fromDate: windowSpec.date, toDate: windowSpec.date };
  }
  return { fromDate: windowSpec.from, toDate: windowSpec.to };
}

// ---------------------------------------------------------------------------
// Base aggregations — one query per metric, grouped by exec_user_id
// ---------------------------------------------------------------------------

interface RawMetrics {
  /** Sum of inbound paise (excludes voided). */
  revenuePaise: number;
  /** Count of completed customer-facing visits. */
  visits: number;
  /** Count of quotations submitted by this exec. */
  quotations: number;
  /** Count of requests this exec is currently assigned to that transitioned
   *  into ORDER_CONFIRMED inside the window. */
  orders: number;
  /** Count of tasks marked done (in window, this exec). */
  tasksDone: number;
  /** Count of all tasks (any status) (in window, this exec). */
  tasksTotal: number;
}

function emptyMetrics(): RawMetrics {
  return {
    revenuePaise: 0,
    visits: 0,
    quotations: 0,
    orders: 0,
    tasksDone: 0,
    tasksTotal: 0,
  };
}

async function loadRawMetrics(
  fromDate: string,
  toDate: string,
): Promise<Map<string, RawMetrics>> {
  const out = new Map<string, RawMetrics>();
  const get = (id: string): RawMetrics => {
    let row = out.get(id);
    if (!row) {
      row = emptyMetrics();
      out.set(id, row);
    }
    return row;
  };

  // Run all aggregations in parallel.
  const [revenueRows, visitRows, quotationRows, orderRows, taskRows] =
    await Promise.all([
      // Revenue: sum inbound payments, attributed to the visit_request's
      // assigned exec. Critical: captains often record payments on behalf
      // of their team's execs (Arjun → Veera's deal, etc.); the action-
      // taker column `payments.recorded_by_user_id` would credit the
      // captain. HVA-201 fix 2026-06-01: group by `assigned_exec_user_id`.
      // Sandeep 2026-06-03: revenue is net cash = inbound − outbound,
      // not inbound only. Refunds reduce the leaderboard credit.
      db
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
            sql`${payments.voidedAt} IS NULL`,
            gte(payments.paymentDate, fromDate),
            lte(payments.paymentDate, toDate),
            sql`${visitRequests.assignedExecUserId} IS NOT NULL`,
          ),
        )
        .groupBy(visitRequests.assignedExecUserId),
      // Visits: customer-facing completed tasks per exec.
      db
        .select({
          execUserId: tasks.execUserId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.status, 'completed'),
            inArray(tasks.taskType, [
              'Customer home visit',
              'Sales pitch',
              'Outlet visit',
            ]),
            gte(tasks.taskDate, fromDate),
            lte(tasks.taskDate, toDate),
          ),
        )
        .groupBy(tasks.execUserId),
      // Quotations: attributed to the visit_request's assigned exec.
      // Same attribution rule as Revenue — captains commonly submit
      // quotations on behalf of execs, so `quotations.submitted_by_user_id`
      // would credit the captain. Group by `assigned_exec_user_id` of
      // the visit_request so the deal-owner gets the credit (HVA-201 fix
      // 2026-06-01).
      db
        .select({
          execUserId: visitRequests.assignedExecUserId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(quotations)
        .innerJoin(
          visitRequests,
          eq(visitRequests.id, quotations.visitRequestId),
        )
        .where(
          and(
            gte(sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`, fromDate),
            lte(sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`, toDate),
            sql`${visitRequests.assignedExecUserId} IS NOT NULL`,
          ),
        )
        .groupBy(visitRequests.assignedExecUserId),
      // Orders: requests transitioned to ORDER_CONFIRMED in window.
      // Counts by currently-assigned exec (mirrors the dashboard's
      // semantics). Reassignment after order-confirmed: credit follows
      // the current assignee. Edge case acknowledged; not a fairness
      // issue in practice since reassignment-after-confirmed is rare.
      //
      // 2026-06-01 fix: COUNT(DISTINCT request_id) — a request that gets
      // rolled back and re-advanced to ORDER_CONFIRMED produces multiple
      // request_status_history rows for the same target stage. Without
      // DISTINCT the exec would be credited for each re-confirmation.
      db
        .select({
          execUserId: visitRequests.assignedExecUserId,
          count: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
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
            eq(statusStages.code, 'ORDER_CONFIRMED'),
            gte(sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`, fromDate),
            lte(sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`, toDate),
            sql`${visitRequests.assignedExecUserId} IS NOT NULL`,
          ),
        )
        .groupBy(visitRequests.assignedExecUserId),
      // Task completion: done + total counts per exec.
      db
        .select({
          execUserId: tasks.execUserId,
          done: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')::int`,
          total: sql<number>`COUNT(*)::int`,
        })
        .from(tasks)
        .where(
          and(
            gte(tasks.taskDate, fromDate),
            lte(tasks.taskDate, toDate),
          ),
        )
        .groupBy(tasks.execUserId),
    ]);

  for (const r of revenueRows) {
    if (r.execUserId) get(r.execUserId).revenuePaise = Number(r.totalPaise);
  }
  for (const r of visitRows) {
    get(r.execUserId).visits = r.count;
  }
  for (const r of quotationRows) {
    if (r.execUserId) get(r.execUserId).quotations = r.count;
  }
  for (const r of orderRows) {
    if (r.execUserId) get(r.execUserId).orders = r.count;
  }
  for (const r of taskRows) {
    const row = get(r.execUserId);
    row.tasksDone = r.done;
    row.tasksTotal = r.total;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Active exec identity — name + captain + first city
// ---------------------------------------------------------------------------

interface ExecIdentity {
  execUserId: string;
  fullName: string;
  captainName: string | null;
  /** First city alphabetical of the exec's captain. Null if captain has none. */
  cityName: string | null;
}

async function loadActiveExecIdentities(): Promise<ExecIdentity[]> {
  // Active sales execs + their captain's first city. The "first city" is
  // a display heuristic — a captain may own multiple cities; we render the
  // alphabetically-first to give the leaderboard a single city per row.
  const rows = await db
    .select({
      execUserId: salesExecutives.userId,
      fullName: users.fullName,
      captainUserId: salesExecutives.captainUserId,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(eq(users.isActive, true));

  if (rows.length === 0) return [];

  const captainIds = [...new Set(rows.map((r) => r.captainUserId))];

  const [captainUserRows, captainCityRows] = await Promise.all([
    db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, captainIds)),
    db
      .select({
        captainUserId: cities.captainUserId,
        cityName: cities.name,
      })
      .from(cities)
      .where(
        and(
          inArray(cities.captainUserId, captainIds),
          eq(cities.isActive, true),
        ),
      )
      .orderBy(asc(cities.name)),
  ]);

  const captainNameById = new Map<string, string>();
  for (const c of captainUserRows) captainNameById.set(c.id, c.fullName);

  const firstCityByCaptain = new Map<string, string>();
  for (const c of captainCityRows) {
    if (c.captainUserId && !firstCityByCaptain.has(c.captainUserId)) {
      firstCityByCaptain.set(c.captainUserId, c.cityName);
    }
  }

  return rows.map((r) => ({
    execUserId: r.execUserId,
    fullName: r.fullName,
    captainName: captainNameById.get(r.captainUserId) ?? null,
    cityName: firstCityByCaptain.get(r.captainUserId) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Composite score — normalised + weighted
// ---------------------------------------------------------------------------

interface CompositeWeights {
  revenue: number;
  conversion_pct: number;
  orders: number;
  visits: number;
  quotations: number;
  task_completion_pct: number;
}

const DEFAULT_WEIGHTS: CompositeWeights = {
  revenue: 0.35,
  conversion_pct: 0.2,
  orders: 0.15,
  visits: 0.1,
  quotations: 0.1,
  task_completion_pct: 0.1,
};

function normaliseWeights(raw: unknown): CompositeWeights {
  if (raw === null || typeof raw !== 'object') return DEFAULT_WEIGHTS;
  const r = raw as Record<string, unknown>;
  const keys: Array<keyof CompositeWeights> = [
    'revenue',
    'conversion_pct',
    'orders',
    'visits',
    'quotations',
    'task_completion_pct',
  ];
  const parsed: Partial<CompositeWeights> = {};
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) parsed[k] = v;
    else parsed[k] = DEFAULT_WEIGHTS[k];
  }
  const out = parsed as CompositeWeights;
  const sum = keys.reduce((acc, k) => acc + out[k], 0);
  if (sum === 0) return DEFAULT_WEIGHTS;
  // Renormalise so the weights sum to 1 (handles partial admin edits).
  return Object.fromEntries(
    keys.map((k) => [k, out[k] / sum]),
  ) as unknown as CompositeWeights;
}

interface DerivedMetrics extends RawMetrics {
  /** Rupees (paise / 100). */
  revenueRupees: number;
  /** orders/visits × 100, null when visits=0. */
  conversionPct: number | null;
  /** done/total × 100, null when total=0. */
  taskCompletionPct: number | null;
}

function deriveMetrics(raw: RawMetrics): DerivedMetrics {
  return {
    ...raw,
    revenueRupees: raw.revenuePaise / 100,
    conversionPct:
      raw.visits > 0 ? (raw.orders / raw.visits) * 100 : null,
    taskCompletionPct:
      raw.tasksTotal > 0 ? (raw.tasksDone / raw.tasksTotal) * 100 : null,
  };
}

function normalisedScore(value: number, max: number): number {
  if (max <= 0) return 0;
  return (value / max) * 100;
}

function computeCompositeScore(
  derived: DerivedMetrics,
  maxes: {
    revenue: number;
    conversion: number;
    orders: number;
    visits: number;
    quotations: number;
    taskCompletion: number;
  },
  weights: CompositeWeights,
): number {
  const components: number[] = [
    normalisedScore(derived.revenueRupees, maxes.revenue) * weights.revenue,
    normalisedScore(derived.conversionPct ?? 0, maxes.conversion) *
      weights.conversion_pct,
    normalisedScore(derived.orders, maxes.orders) * weights.orders,
    normalisedScore(derived.visits, maxes.visits) * weights.visits,
    normalisedScore(derived.quotations, maxes.quotations) *
      weights.quotations,
    normalisedScore(derived.taskCompletionPct ?? 0, maxes.taskCompletion) *
      weights.task_completion_pct,
  ];
  return components.reduce((acc, v) => acc + v, 0);
}

// ---------------------------------------------------------------------------
// Prior-window helper — HVA-201 delta arrows
// ---------------------------------------------------------------------------

/** Same-length prior window ending at `fromDate - 1 day`. Used for the
 *  rank-delta arrows on the leaderboard ("you moved +2 / -1 vs last
 *  period"). */
function priorWindow(currentFrom: string, currentTo: string): {
  fromDate: string;
  toDate: string;
} {
  const [yf, mf, df] = currentFrom.split('-').map(Number);
  const [yt, mt, dt] = currentTo.split('-').map(Number);
  const fromUtc = new Date(Date.UTC(yf, mf - 1, df));
  const toUtc = new Date(Date.UTC(yt, mt - 1, dt));
  const lengthDays =
    Math.round((toUtc.getTime() - fromUtc.getTime()) / 86400000) + 1;
  const priorTo = new Date(fromUtc);
  priorTo.setUTCDate(priorTo.getUTCDate() - 1);
  const priorFrom = new Date(priorTo);
  priorFrom.setUTCDate(priorFrom.getUTCDate() - (lengthDays - 1));
  const toIso = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { fromDate: toIso(priorFrom), toDate: toIso(priorTo) };
}

/** Build the sorted rank rows from raw metrics + identities. Pure logic;
 *  shared between current + prior period invocations. */
function buildRankedRows(args: {
  identities: ExecIdentity[];
  rawMap: Map<string, RawMetrics>;
  weights: CompositeWeights;
  metric: LeaderboardMetric;
}): Array<{
  identity: ExecIdentity;
  derived: DerivedMetrics;
  metricValue: number | null;
  compositeScore: number;
  rank: number;
}> {
  const derivedMap = new Map<string, DerivedMetrics>();
  for (const id of args.identities) {
    const raw = args.rawMap.get(id.execUserId) ?? emptyMetrics();
    derivedMap.set(id.execUserId, deriveMetrics(raw));
  }
  const maxes = {
    revenue: 0,
    conversion: 0,
    orders: 0,
    visits: 0,
    quotations: 0,
    taskCompletion: 0,
  };
  for (const d of derivedMap.values()) {
    maxes.revenue = Math.max(maxes.revenue, d.revenueRupees);
    if (d.conversionPct !== null)
      maxes.conversion = Math.max(maxes.conversion, d.conversionPct);
    maxes.orders = Math.max(maxes.orders, d.orders);
    maxes.visits = Math.max(maxes.visits, d.visits);
    maxes.quotations = Math.max(maxes.quotations, d.quotations);
    if (d.taskCompletionPct !== null)
      maxes.taskCompletion = Math.max(
        maxes.taskCompletion,
        d.taskCompletionPct,
      );
  }
  const pre = args.identities.map((id) => {
    const derived = derivedMap.get(id.execUserId)!;
    const compositeScore = computeCompositeScore(derived, maxes, args.weights);
    let metricValue: number | null;
    switch (args.metric) {
      case 'composite':
        metricValue = compositeScore;
        break;
      case 'revenue':
        metricValue = derived.revenueRupees;
        break;
      case 'visits':
        metricValue = derived.visits;
        break;
      case 'quotations':
        metricValue = derived.quotations;
        break;
      case 'orders':
        metricValue = derived.orders;
        break;
      case 'conversion_pct':
        metricValue = derived.conversionPct;
        break;
      case 'task_completion_pct':
        metricValue = derived.taskCompletionPct;
        break;
    }
    return { identity: id, derived, metricValue, compositeScore };
  });
  pre.sort((a, b) => {
    const av = a.metricValue;
    const bv = b.metricValue;
    if (av === null && bv === null) {
      /* fall through to tie-break */
    } else if (av === null) return 1;
    else if (bv === null) return -1;
    else if (av !== bv) return bv - av;
    if (a.derived.revenueRupees !== b.derived.revenueRupees) {
      return b.derived.revenueRupees - a.derived.revenueRupees;
    }
    const ac = a.derived.conversionPct ?? 0;
    const bc = b.derived.conversionPct ?? 0;
    if (ac !== bc) return bc - ac;
    if (a.derived.visits !== b.derived.visits)
      return b.derived.visits - a.derived.visits;
    return a.identity.fullName.localeCompare(b.identity.fullName);
  });
  const out: Array<{
    identity: ExecIdentity;
    derived: DerivedMetrics;
    metricValue: number | null;
    compositeScore: number;
    rank: number;
  }> = [];
  let lastValue: number | null | typeof NEEDS_INIT = NEEDS_INIT;
  let lastRank = 0;
  for (let i = 0; i < pre.length; i++) {
    const p = pre[i];
    const v = p.metricValue;
    let rank: number;
    if (lastValue === NEEDS_INIT || v !== lastValue) {
      rank = i + 1;
    } else {
      rank = lastRank;
    }
    lastValue = v;
    lastRank = rank;
    out.push({ ...p, rank });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export async function loadLeaderboard(
  args: LoadLeaderboardArgs,
): Promise<LeaderboardRow[]> {
  const { fromDate, toDate } = resolveWindow(args.window);
  const prior = priorWindow(fromDate, toDate);
  const [identities, rawMap, priorRawMap, rawWeights] = await Promise.all([
    loadActiveExecIdentities(),
    loadRawMetrics(fromDate, toDate),
    loadRawMetrics(prior.fromDate, prior.toDate),
    getConfig('leaderboard_composite_weights'),
  ]);
  const weights = normaliseWeights(rawWeights);

  const currentRanked = buildRankedRows({
    identities,
    rawMap,
    weights,
    metric: args.metric,
  });
  const priorRanked = buildRankedRows({
    identities,
    rawMap: priorRawMap,
    weights,
    metric: args.metric,
  });
  const priorRankByExec = new Map<string, number>();
  for (const r of priorRanked) {
    // Only count "prior period engaged" if the exec had any meaningful
    // metric value (non-null, non-zero). Otherwise treat them as new
    // (delta = null) so we don't report a phantom climb from a default
    // bottom rank.
    if (r.metricValue !== null && r.metricValue > 0) {
      priorRankByExec.set(r.identity.execUserId, r.rank);
    }
  }

  // HVA-201 streak — one batch query for all execs on the board.
  const streaks = await loadStreaksForExecs(
    currentRanked.map((p) => p.identity.execUserId),
  );

  return currentRanked.map((p) => {
    const priorRank = priorRankByExec.get(p.identity.execUserId);
    // delta = priorRank - currentRank → positive means climbed.
    const rankDelta =
      priorRank === undefined ? null : priorRank - p.rank;
    return {
      execUserId: p.identity.execUserId,
      fullName: p.identity.fullName,
      cityName: p.identity.cityName,
      captainName: p.identity.captainName,
      metricValue: p.metricValue,
      compositeScore: p.compositeScore,
      rank: p.rank,
      rankDelta,
      streakDays: streaks.get(p.identity.execUserId) ?? 0,
    };
  });
}

const NEEDS_INIT = Symbol('needs-init');
