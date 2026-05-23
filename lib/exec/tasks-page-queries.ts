import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { outcomeOptions, tasks } from '@/db/schema';
import { DEFAULT_PAGE_SIZE, computePageRange } from '@/lib/pagination';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-170: /tasks page server-side data fetchers
// =============================================================================
//
// Separate file from lib/exec/dashboard-queries.ts so the dashboard accordion
// can keep its today-bounded semantics while the Tasks page surfaces
// everything the exec has open. Both files share the underlying tasks
// schema and the same row shape (with an added `completedAt` field here so
// the Completed list can group rows by IST completion date).
//
// Helpers:
//   - loadExecAllPendingTasks     → ALL status='pending' (incl. future)
//   - loadExecAllPostponedTasks   → ALL status='postponed' (incl. future)
//   - loadExecCompletedTasksPaginated → status='completed' + LIMIT/OFFSET
//                                       + optional [from, to] window
//   - loadExecLastWeekOpenTasks   → pending|postponed in [today-7, today]
//                                   (drives /today PreSubmissionView accordion)
// =============================================================================

export interface ExecTaskRow {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
  outcomeOptionId: string | null;
  outcomeOptionName: string | null;
  outcomeNotes: string | null;
  postponedToDate: string | null;
  customerInformed: boolean | null;
  rolledOverAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RawTaskRow {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
  outcomeOptionId: string | null;
  outcomeOptionName: string | null;
  outcomeNotes: string | null;
  postponedToDate: string | null;
  customerInformed: boolean | null;
  rolledOverAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

function mapTaskRow(t: RawTaskRow): ExecTaskRow {
  return {
    id: t.id,
    taskType: t.taskType,
    description: t.description,
    estimatedTime: t.estimatedTime,
    status: t.status,
    taskDate: t.taskDate,
    linkRequestId: t.linkRequestId,
    linkLeadId: t.linkLeadId,
    outcomeOptionId: t.outcomeOptionId,
    outcomeOptionName: t.outcomeOptionName,
    outcomeNotes: t.outcomeNotes,
    postponedToDate: t.postponedToDate,
    customerInformed: t.customerInformed,
    rolledOverAt: t.rolledOverAt ? t.rolledOverAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

const ROW_COLUMNS = {
  id: tasks.id,
  taskType: tasks.taskType,
  description: tasks.description,
  estimatedTime: tasks.estimatedTime,
  status: tasks.status,
  taskDate: tasks.taskDate,
  linkRequestId: tasks.linkRequestId,
  linkLeadId: tasks.linkLeadId,
  outcomeOptionId: tasks.outcomeOptionId,
  outcomeOptionName: outcomeOptions.name,
  outcomeNotes: tasks.outcomeNotes,
  postponedToDate: tasks.postponedToDate,
  customerInformed: tasks.customerInformed,
  rolledOverAt: tasks.rolledOverAt,
  completedAt: tasks.completedAt,
  createdAt: tasks.createdAt,
};

// -----------------------------------------------------------------------------
// Pending — all open work (today + future + rolled-over). No date filter.
// -----------------------------------------------------------------------------

export async function loadExecAllPendingTasks(
  execUserId: string,
): Promise<ExecTaskRow[]> {
  const rows = await db
    .select(ROW_COLUMNS)
    .from(tasks)
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .where(and(eq(tasks.execUserId, execUserId), eq(tasks.status, 'pending')))
    // Oldest first so rolled-over and overdue surface above future-dated work.
    .orderBy(asc(tasks.taskDate), asc(tasks.createdAt));
  return rows.map(mapTaskRow);
}

// -----------------------------------------------------------------------------
// Postponed — all status='postponed' (today + overdue + future). Future-
// scheduled rows render a "scheduled for <date>" pill in the UI.
// -----------------------------------------------------------------------------

export async function loadExecAllPostponedTasks(
  execUserId: string,
): Promise<ExecTaskRow[]> {
  const rows = await db
    .select(ROW_COLUMNS)
    .from(tasks)
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .where(and(eq(tasks.execUserId, execUserId), eq(tasks.status, 'postponed')))
    // Oldest target first — overdue floats up. NULL postponed_to_date is
    // unusual but sorts last by default in Postgres ASC.
    .orderBy(asc(tasks.postponedToDate), asc(tasks.createdAt));
  return rows.map(mapTaskRow);
}

// -----------------------------------------------------------------------------
// Completed — paginated history with optional [from, to] IST date window.
// -----------------------------------------------------------------------------

export interface CompletedTasksPage {
  tasks: ExecTaskRow[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
  };
  /** Tasks grouped by IST completion date, newest first. */
  groupedByDate: Array<{ istDate: string; tasks: ExecTaskRow[] }>;
}

export interface CompletedTasksFilter {
  page: number;
  pageSize?: number;
  /** Inclusive YYYY-MM-DD; matches against completed_at AT TIME ZONE 'Asia/Kolkata'. */
  dateFrom?: string | null;
  /** Inclusive YYYY-MM-DD. */
  dateTo?: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(s: string | null | undefined): s is string {
  return typeof s === 'string' && ISO_DATE_RE.test(s);
}

export async function loadExecCompletedTasksPaginated(
  execUserId: string,
  opts: CompletedTasksFilter,
): Promise<CompletedTasksPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = validIsoDate(opts.dateFrom) ? opts.dateFrom : null;
  const to = validIsoDate(opts.dateTo) ? opts.dateTo : null;

  // Window filter: compare on the IST calendar date of completed_at.
  // `completed_at AT TIME ZONE 'Asia/Kolkata'` reinterprets the
  // timestamptz as wall-clock in IST (returns timestamp without tz),
  // then ::date truncates. Result: plain date math against the
  // YYYY-MM-DD bounds. Simpler + more robust than building IST-anchored
  // timestamptz boundaries (HVA-170 ship gate hit a boundary edge case
  // with the previous form; HVA-170-FIX2 standardises on this).
  const whereClauses = [
    eq(tasks.execUserId, execUserId),
    eq(tasks.status, 'completed'),
  ];
  if (from !== null) {
    whereClauses.push(
      sql`(${tasks.completedAt} AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date`,
    );
  }
  if (to !== null) {
    whereClauses.push(
      sql`(${tasks.completedAt} AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`,
    );
  }
  const whereExpr = and(...whereClauses);

  const [[countRow], rows] = await Promise.all([
    db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(tasks)
      .where(whereExpr),
    db
      .select(ROW_COLUMNS)
      .from(tasks)
      .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
      .where(whereExpr)
      .orderBy(desc(tasks.completedAt))
      .limit(pageSize)
      .offset((Math.max(1, opts.page) - 1) * pageSize),
  ]);

  const totalCount = countRow?.cnt ?? 0;
  const range = computePageRange({
    total: totalCount,
    page: opts.page,
    pageSize,
  });

  const mapped = rows.map(mapTaskRow);

  // Group by IST date derived from completedAt. App-side keeps the SQL
  // simple and reuses the existing IST helper.
  const groupMap = new Map<string, ExecTaskRow[]>();
  for (const row of mapped) {
    if (!row.completedAt) continue; // defensive — status='completed' implies non-null
    const istDate = getIstDateString(new Date(row.completedAt));
    if (!groupMap.has(istDate)) groupMap.set(istDate, []);
    groupMap.get(istDate)!.push(row);
  }
  const groupedByDate = Array.from(groupMap.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest first
    .map(([istDate, ts]) => ({ istDate, tasks: ts }));

  return {
    tasks: mapped,
    pagination: {
      currentPage: range.page,
      totalPages: range.totalPages,
      totalCount,
      pageSize,
    },
    groupedByDate,
  };
}

// -----------------------------------------------------------------------------
// Last 7 days of open work — drives /today PreSubmissionView accordion (D6).
// -----------------------------------------------------------------------------

function offsetIstDate(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export async function loadExecLastWeekOpenTasks(
  execUserId: string,
  now: Date = new Date(),
): Promise<ExecTaskRow[]> {
  const today = getIstDateString(now);
  const sevenDaysAgo = offsetIstDate(today, -7);
  const rows = await db
    .select(ROW_COLUMNS)
    .from(tasks)
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .where(
      and(
        eq(tasks.execUserId, execUserId),
        inArray(tasks.status, ['pending', 'postponed'] as const),
        gte(tasks.taskDate, sevenDaysAgo),
        lte(tasks.taskDate, today),
      ),
    )
    .orderBy(desc(tasks.taskDate), asc(tasks.status), asc(tasks.createdAt));
  return rows.map(mapTaskRow);
}

// Silence unused-import warnings if downstream tests need them later.
void lt;
