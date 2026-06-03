import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

import { formatPaise } from './sales';
import type { ReportArgs, ReportResult } from './types';
import { REPORT_PAGE_SIZE } from './types';

// =============================================================================
// WhatsApp / notification telemetry (39-41) + Targets (42-44)
// =============================================================================

function paginate<T>(rows: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

// 39. Messages sent per template
interface MsgRow {
  templateName: string;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
}

export async function reportWaMessagesPerTemplate(
  args: ReportArgs,
): Promise<ReportResult<MsgRow>> {
  void args;
  const result = await db.execute<{
    template: string;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  }>(sql`
    SELECT
      template_name AS template,
      COUNT(*)::int AS sent,
      SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END)::int AS delivered,
      SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END)::int AS read,
      SUM(CASE WHEN failed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS failed
    FROM whatsapp_dispatches
    GROUP BY template_name
    ORDER BY sent DESC
  `);
  const raw =
    (result as unknown as { rows?: Array<{ template: string; sent: number; delivered: number; read: number; failed: number }> }).rows
    ?? (result as unknown as Array<{ template: string; sent: number; delivered: number; read: number; failed: number }>);
  const rows = (raw ?? []).map<MsgRow>((r) => ({
    templateName: r.template,
    sentCount: r.sent,
    deliveredCount: r.delivered,
    readCount: r.read,
    failedCount: r.failed,
  }));
  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'templateName', label: 'Template', format: 'string', align: 'left' },
      { key: 'sentCount', label: 'Sent', format: 'number', align: 'right' },
      { key: 'deliveredCount', label: 'Delivered', format: 'number', align: 'right' },
      { key: 'readCount', label: 'Read', format: 'number', align: 'right' },
      { key: 'failedCount', label: 'Failed', format: 'number', align: 'right' },
    ],
    footer: {
      entries: [
        { label: 'Templates', value: String(rows.length) },
        {
          label: 'Total sent',
          value: String(rows.reduce((s, r) => s + r.sentCount, 0)),
        },
      ],
    },
  };
}

// 40. Delivery + read rates per template
interface RateRow {
  templateName: string;
  sentCount: number;
  deliveryPct: number | null;
  readPct: number | null;
}

export async function reportWaDeliveryRates(
  args: ReportArgs,
): Promise<ReportResult<RateRow>> {
  const msgs = await reportWaMessagesPerTemplate(args);
  const rows = (msgs.rows as MsgRow[]).map<RateRow>((r) => ({
    templateName: r.templateName,
    sentCount: r.sentCount,
    deliveryPct:
      r.sentCount > 0 ? Math.round((r.deliveredCount / r.sentCount) * 100) : null,
    readPct:
      r.sentCount > 0 ? Math.round((r.readCount / r.sentCount) * 100) : null,
  }));
  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'templateName', label: 'Template', format: 'string', align: 'left' },
      { key: 'sentCount', label: 'Sent', format: 'number', align: 'right' },
      { key: 'deliveryPct', label: 'Delivery %', format: 'percent', align: 'right' },
      { key: 'readPct', label: 'Read %', format: 'percent', align: 'right' },
    ],
  };
}

// 41. Failure reasons
interface FailRow {
  failureCode: string;
  failureReason: string;
  count: number;
}

export async function reportWaFailures(
  args: ReportArgs,
): Promise<ReportResult<FailRow>> {
  void args;
  const result = await db.execute<{
    code: string;
    reason: string;
    cnt: number;
  }>(sql`
    SELECT
      COALESCE(failure_code, 'unknown')::text AS code,
      COALESCE(failure_reason, 'unspecified')::text AS reason,
      COUNT(*)::int AS cnt
    FROM whatsapp_dispatches
    WHERE failed_at IS NOT NULL
    GROUP BY failure_code, failure_reason
    ORDER BY cnt DESC
  `);
  const raw =
    (result as unknown as { rows?: Array<{ code: string; reason: string; cnt: number }> }).rows
    ?? (result as unknown as Array<{ code: string; reason: string; cnt: number }>);
  const rows = (raw ?? []).map<FailRow>((r) => ({
    failureCode: r.code,
    failureReason: r.reason,
    count: r.cnt,
  }));
  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'failureCode', label: 'Code', format: 'string', align: 'left' },
      { key: 'failureReason', label: 'Reason', format: 'string', align: 'left' },
      { key: 'count', label: 'Occurrences', format: 'number', align: 'right' },
    ],
    footer: {
      entries: [
        { label: 'Total failures', value: String(rows.reduce((s, r) => s + r.count, 0)) },
      ],
    },
  };
}

// =============================================================================
// Targets reports (42-44)
// =============================================================================

import { eq, and } from 'drizzle-orm';

import { salesExecutives, users } from '@/db/schema';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadMonthlyTargetPaise,
} from '@/lib/exec/target-progress';

interface ExecTargetRow {
  execUserId: string;
  execName: string;
  cityNames: string;
  ordersPaise: number;
  revenuePaise: number;
  targetPaise: number;
  ordersPct: number;
  revenuePct: number;
  combinedRatio: number;
}

// 42. Per-exec monthly target achievement
export async function reportExecTargetAchievement(
  args: ReportArgs,
): Promise<ReportResult<ExecTargetRow>> {
  void args;
  const window = getCurrentMonthWindow();
  const target = await loadMonthlyTargetPaise();
  const rows = await loadAllExecTargetProgress(window, target);
  const mapped: ExecTargetRow[] = rows.map((r) => ({
    execUserId: r.execUserId,
    execName: r.fullName,
    cityNames: (r.cityNames ?? []).join(', '),
    ordersPaise: r.ordersPaise,
    revenuePaise: r.revenuePaise,
    targetPaise: target,
    ordersPct: Math.round((r.ordersPaise / target) * 100),
    revenuePct: Math.round((r.revenuePaise / target) * 100),
    combinedRatio: Math.round(r.combinedRatio * 100),
  }));
  const sortKey = args.sort?.key ?? 'combinedRatio';
  const dir = args.sort?.direction ?? 'desc';
  mapped.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(mapped, page, pageSize),
    total: mapped.length,
    columns: [
      { key: 'execName', label: 'Executive', format: 'string', align: 'left', sortable: true },
      { key: 'cityNames', label: 'City', format: 'string', align: 'left' },
      { key: 'targetPaise', label: 'Target (₹)', format: 'currency_paise', align: 'right' },
      { key: 'ordersPaise', label: 'Orders this month (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'ordersPct', label: 'Orders %', format: 'percent', align: 'right', sortable: true },
      { key: 'revenuePaise', label: 'Revenue this month (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'revenuePct', label: 'Revenue %', format: 'percent', align: 'right', sortable: true },
      { key: 'combinedRatio', label: 'Combined %', format: 'percent', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Execs tracked', value: String(mapped.length) },
        { label: 'Days in month', value: String((window.daysElapsed + window.daysLeft)) },
        { label: 'Days elapsed', value: String(window.daysElapsed) },
        { label: 'Target per exec', value: formatPaise(target) },
      ],
    },
  };
}

// 43. Team / city target rollup
interface CityTargetRow {
  cityName: string;
  execCount: number;
  targetTotalPaise: number;
  ordersPaise: number;
  revenuePaise: number;
  combinedPct: number;
}

export async function reportCityTargetRollup(
  args: ReportArgs,
): Promise<ReportResult<CityTargetRow>> {
  void args;
  const window = getCurrentMonthWindow();
  const target = await loadMonthlyTargetPaise();
  const rows = await loadAllExecTargetProgress(window, target);

  // Bucket by city. An exec with multiple cities is counted once per
  // city (split equally).
  const map = new Map<string, CityTargetRow>();
  for (const r of rows) {
    const cities = r.cityNames && r.cityNames.length > 0 ? r.cityNames : ['—'];
    for (const c of cities) {
      const e = map.get(c) ?? {
        cityName: c,
        execCount: 0,
        targetTotalPaise: 0,
        ordersPaise: 0,
        revenuePaise: 0,
        combinedPct: 0,
      };
      e.execCount += 1;
      e.targetTotalPaise += target;
      e.ordersPaise += Math.round(r.ordersPaise / cities.length);
      e.revenuePaise += Math.round(r.revenuePaise / cities.length);
      map.set(c, e);
    }
  }
  for (const v of map.values()) {
    const denom = v.targetTotalPaise * 2;
    v.combinedPct =
      denom > 0
        ? Math.round(((v.ordersPaise + v.revenuePaise) / denom) * 100)
        : 0;
  }
  let all = Array.from(map.values());
  const sortKey = args.sort?.key ?? 'combinedPct';
  const dir = args.sort?.direction ?? 'desc';
  all.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    let cmp = 0;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'cityName', label: 'City', format: 'string', align: 'left', sortable: true },
      { key: 'execCount', label: 'Execs', format: 'number', align: 'right', sortable: true },
      { key: 'targetTotalPaise', label: 'Target total (₹)', format: 'currency_paise', align: 'right' },
      { key: 'ordersPaise', label: 'Orders (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'revenuePaise', label: 'Revenue (₹)', format: 'currency_paise', align: 'right', sortable: true },
      { key: 'combinedPct', label: 'Combined %', format: 'percent', align: 'right', sortable: true },
    ],
  };
}

// 44. Target pacing — days remaining vs ratio achieved
interface PacingRow {
  metric: string;
  daysElapsed: number;
  daysRemaining: number;
  expectedPct: number;
  achievedPct: number;
  gap: number;
}

export async function reportTargetPacing(
  args: ReportArgs,
): Promise<ReportResult<PacingRow>> {
  void args;
  const window = getCurrentMonthWindow();
  const target = await loadMonthlyTargetPaise();
  const rows = await loadAllExecTargetProgress(window, target);
  const totalOrders = rows.reduce((s, r) => s + r.ordersPaise, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenuePaise, 0);
  const totalTarget = target * rows.length;
  const expectedPct =
    (window.daysElapsed + window.daysLeft) > 0
      ? Math.round((window.daysElapsed / (window.daysElapsed + window.daysLeft)) * 100)
      : 0;
  const ordersAchieved =
    totalTarget > 0 ? Math.round((totalOrders / totalTarget) * 100) : 0;
  const revenueAchieved =
    totalTarget > 0 ? Math.round((totalRevenue / totalTarget) * 100) : 0;
  const result: PacingRow[] = [
    {
      metric: 'Orders',
      daysElapsed: window.daysElapsed,
      daysRemaining: window.daysLeft,
      expectedPct,
      achievedPct: ordersAchieved,
      gap: ordersAchieved - expectedPct,
    },
    {
      metric: 'Revenue',
      daysElapsed: window.daysElapsed,
      daysRemaining: window.daysLeft,
      expectedPct,
      achievedPct: revenueAchieved,
      gap: revenueAchieved - expectedPct,
    },
  ];
  return {
    rows: result,
    total: result.length,
    columns: [
      { key: 'metric', label: 'Metric', format: 'string', align: 'left' },
      { key: 'daysElapsed', label: 'Days elapsed', format: 'number', align: 'right' },
      { key: 'daysRemaining', label: 'Days remaining', format: 'number', align: 'right' },
      { key: 'expectedPct', label: 'Expected %', format: 'percent', align: 'right' },
      { key: 'achievedPct', label: 'Achieved %', format: 'percent', align: 'right' },
      { key: 'gap', label: 'Gap (pp)', format: 'number', align: 'right' },
    ],
    footer: {
      entries: [
        { label: 'Month label', value: window.monthLabel },
      ],
    },
  };
}

// Silence the imports the targets section uses through transitive helpers.
void salesExecutives;
void users;
void eq;
void and;
