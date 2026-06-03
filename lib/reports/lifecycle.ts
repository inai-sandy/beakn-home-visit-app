import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';

import type { ReportArgs, ReportResult } from './types';
import { REPORT_PAGE_SIZE } from './types';

// =============================================================================
// Lifecycle reports (31-34)
// =============================================================================
//
// 31. Status-stage funnel — count of distinct requests that ever reached
//     each stage in the window.
// 32. Stuck requests — rows whose current status_stage_id hasn't changed
//     for > N days.
// 33. Average time per stage — for each stage code, the average days
//     spent at that stage before transitioning out.
// 34. New request intake trend — visit_requests.created_at per day.
// =============================================================================

function paginate<T>(rows: T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return rows.slice(start, start + size);
}

// -----------------------------------------------------------------------------
// 31. Status funnel
// -----------------------------------------------------------------------------

interface FunnelRow {
  stageCode: string;
  stageName: string;
  sequenceNumber: number;
  requestsReached: number;
}

export async function reportStatusFunnel(
  args: ReportArgs,
): Promise<ReportResult<FunnelRow>> {
  const { fromDate, toDate } = args.range;

  const stages = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(statusStages.sequenceNumber);

  // For each stage, count distinct requests that EVER transitioned into
  // it within the window.
  const counts = await db
    .select({
      stageId: requestStatusHistory.toStatusStageId,
      cnt: sql<number>`COUNT(DISTINCT ${requestStatusHistory.requestId})::int`,
    })
    .from(requestStatusHistory)
    .where(
      and(
        gte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          fromDate,
        ),
        lte(
          sql`(${requestStatusHistory.changedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          toDate,
        ),
      ),
    )
    .groupBy(requestStatusHistory.toStatusStageId);
  const map = new Map<string, number>();
  for (const r of counts) map.set(r.stageId, r.cnt);

  const rows: FunnelRow[] = stages.map((s) => ({
    stageCode: s.code,
    stageName: s.name,
    sequenceNumber: s.sequenceNumber,
    requestsReached: map.get(s.id) ?? 0,
  }));

  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'sequenceNumber', label: '#', format: 'number', align: 'right' },
      { key: 'stageName', label: 'Stage', format: 'string', align: 'left' },
      { key: 'stageCode', label: 'Code', format: 'string', align: 'left' },
      { key: 'requestsReached', label: 'Requests reached', format: 'number', align: 'right' },
    ],
  };
}

// -----------------------------------------------------------------------------
// 32. Stuck requests (current status unchanged > 7 days)
// -----------------------------------------------------------------------------

interface StuckRow {
  requestId: string;
  customerName: string;
  currentStage: string;
  daysAtStage: number;
}

export async function reportStuckRequests(
  args: ReportArgs,
): Promise<ReportResult<StuckRow>> {
  void args;
  const result = await db.execute<{
    request_id: string;
    customer_name: string;
    stage_name: string;
    days_at_stage: number;
  }>(sql`
    WITH latest_transition AS (
      SELECT rsh.request_id, MAX(rsh.changed_at) AS changed_at
      FROM ${requestStatusHistory} rsh
      GROUP BY rsh.request_id
    )
    SELECT
      vr.id AS request_id,
      vr.customer_name,
      ss.name AS stage_name,
      EXTRACT(DAY FROM NOW() - lt.changed_at)::int AS days_at_stage
    FROM ${visitRequests} vr
    INNER JOIN latest_transition lt ON lt.request_id = vr.id
    INNER JOIN ${statusStages} ss ON ss.id = vr.status_stage_id
    WHERE vr.cancelled_at IS NULL
      AND ss.code != 'ORDER_EXECUTED_SUCCESSFULLY'
      AND lt.changed_at < NOW() - INTERVAL '7 days'
    ORDER BY days_at_stage DESC
  `);
  const raw = (result as unknown as { rows?: Array<{ request_id: string; customer_name: string; stage_name: string; days_at_stage: number }> }).rows
    ?? (result as unknown as Array<{ request_id: string; customer_name: string; stage_name: string; days_at_stage: number }>);

  const all = (raw ?? []).map<StuckRow>((r) => ({
    requestId: r.request_id,
    customerName: r.customer_name,
    currentStage: r.stage_name,
    daysAtStage: r.days_at_stage,
  }));

  const sortKey = args.sort?.key ?? 'daysAtStage';
  const dir = args.sort?.direction ?? 'desc';
  all.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'customerName') cmp = a.customerName.localeCompare(b.customerName);
    else if (sortKey === 'currentStage') cmp = a.currentStage.localeCompare(b.currentStage);
    else cmp = a.daysAtStage - b.daysAtStage;
    return dir === 'asc' ? cmp : -cmp;
  });

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'requestId', label: 'Request', format: 'string', align: 'left', linksToRequest: true },
      { key: 'customerName', label: 'Customer', format: 'string', align: 'left', sortable: true },
      { key: 'currentStage', label: 'Current stage', format: 'string', align: 'left', sortable: true },
      { key: 'daysAtStage', label: 'Days stuck', format: 'days', align: 'right', sortable: true },
    ],
    footer: {
      entries: [{ label: 'Stuck > 7 days', value: String(all.length) }],
    },
  };
}

// -----------------------------------------------------------------------------
// 33. Average days at each stage
// -----------------------------------------------------------------------------

interface StageTimeRow {
  stageCode: string;
  stageName: string;
  averageDays: number;
  transitionCount: number;
}

export async function reportAverageStageTime(
  args: ReportArgs,
): Promise<ReportResult<StageTimeRow>> {
  void args;
  const result = await db.execute<{
    stage_code: string;
    stage_name: string;
    avg_days: number;
    cnt: number;
  }>(sql`
    WITH ordered AS (
      SELECT
        rsh.request_id,
        rsh.to_status_stage_id AS stage_id,
        rsh.changed_at,
        LEAD(rsh.changed_at) OVER (PARTITION BY rsh.request_id ORDER BY rsh.transition_order) AS next_at
      FROM ${requestStatusHistory} rsh
    )
    SELECT
      ss.code AS stage_code,
      ss.name AS stage_name,
      COALESCE(AVG(EXTRACT(EPOCH FROM (next_at - changed_at)) / 86400), 0) AS avg_days,
      COUNT(*)::int AS cnt
    FROM ordered o
    INNER JOIN ${statusStages} ss ON ss.id = o.stage_id
    WHERE next_at IS NOT NULL
    GROUP BY ss.code, ss.name, ss.sequence_number
    ORDER BY ss.sequence_number
  `);
  const raw = (result as unknown as { rows?: Array<{ stage_code: string; stage_name: string; avg_days: number; cnt: number }> }).rows
    ?? (result as unknown as Array<{ stage_code: string; stage_name: string; avg_days: number; cnt: number }>);
  const rows = (raw ?? []).map<StageTimeRow>((r) => ({
    stageCode: r.stage_code,
    stageName: r.stage_name,
    averageDays: Math.round(Number(r.avg_days) * 10) / 10,
    transitionCount: r.cnt,
  }));

  return {
    rows,
    total: rows.length,
    columns: [
      { key: 'stageName', label: 'Stage', format: 'string', align: 'left' },
      { key: 'averageDays', label: 'Avg days to exit', format: 'number', align: 'right' },
      { key: 'transitionCount', label: 'Transitions observed', format: 'number', align: 'right' },
    ],
  };
}

// -----------------------------------------------------------------------------
// 34. New request intake trend
// -----------------------------------------------------------------------------

interface IntakeRow {
  bucket: string;
  newRequests: number;
}

export async function reportRequestIntake(
  args: ReportArgs,
): Promise<ReportResult<IntakeRow>> {
  const { fromDate, toDate } = args.range;

  const rows = await db
    .select({
      bucket: sql<string>`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date::text`,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(visitRequests)
    .where(
      and(
        gte(
          sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          fromDate,
        ),
        lte(
          sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          toDate,
        ),
      ),
    )
    .groupBy(
      sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
    );

  const all = rows.map<IntakeRow>((r) => ({ bucket: r.bucket, newRequests: r.cnt }));
  all.sort((a, b) =>
    args.sort?.direction === 'asc'
      ? a.bucket.localeCompare(b.bucket)
      : b.bucket.localeCompare(a.bucket),
  );

  const page = args.pagination?.page ?? 1;
  const pageSize = args.pagination?.pageSize ?? REPORT_PAGE_SIZE;
  return {
    rows: paginate(all, page, pageSize),
    total: all.length,
    columns: [
      { key: 'bucket', label: 'Date', format: 'date', align: 'left', sortable: true },
      { key: 'newRequests', label: 'New requests', format: 'number', align: 'right', sortable: true },
    ],
    footer: {
      entries: [
        { label: 'Days observed', value: String(all.length) },
        {
          label: 'Total new requests',
          value: String(all.reduce((s, r) => s + r.newRequests, 0)),
        },
      ],
    },
  };
}
