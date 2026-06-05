import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/db/client';
import {
  leads,
  outcomeOptions,
  salesExecutives,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-201 follow-up: shared tasks-table loader
// =============================================================================
//
// One server-side loader for the new /captain/tasks and /admin/tasks
// pages. Supports:
//
//   * scope:    exec / captain / global
//   * status:   pending / postponed / completed / all
//   * date:     ?from=YYYY-MM-DD&to=YYYY-MM-DD (against task_date for
//               pending+postponed, completed_at IST for completed,
//               combined for 'all')
//   * sort:     'date' (asc/desc) — date axis depends on the section:
//               taskDate for pending/postponed/all, completed_at for
//               completed; tie-break by createdAt
//   * filter:   captain_user_id, exec_user_id (for admin/captain)
//   * search:   free-text against description + linked customer name
//   * page:     1-based with pageSize (default 20)
//
// Attribution: tasks.exec_user_id is the assigned exec (same field
// the dashboard uses). Captain visibility = join salesExecutives on
// captain_user_id. Admin = no narrow.
// =============================================================================

export const DEFAULT_PAGE_SIZE = 20;

export type TasksTableScope =
  | { kind: 'exec'; execUserId: string }
  | { kind: 'captain'; captainUserId: string }
  | { kind: 'global' };

export type TasksTableStatus =
  | 'all'
  | 'pending'
  | 'postponed'
  | 'completed';

export interface TasksTableArgs {
  scope: TasksTableScope;
  status: TasksTableStatus;
  from?: string;
  to?: string;
  captainUserId?: string;
  execUserId?: string;
  search?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface TasksTableRow {
  id: string;
  taskType: string;
  description: string;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  completedAt: string | null;
  postponedToDate: string | null;
  estimatedTime: string;
  outcomeName: string | null;
  outcomeNotes: string | null;
  execUserId: string;
  execName: string;
  captainUserId: string | null;
  captainName: string | null;
  linkedCustomerName: string | null;
  linkRequestId: string | null;
  linkLeadId: string | null;
  /** The IST date relevant to the current sort axis. For completed
   *  rows this is completedAt's IST date; otherwise it's task_date.
   *  Used by the page to render the leading column. */
  primaryDate: string;
}

export interface TasksTableResult {
  rows: TasksTableRow[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  /** Captain dropdown facets — admin only; empty array for captain
   *  scope (they only see their own team). */
  captainFacets: Array<{ id: string; name: string }>;
  /** Exec dropdown facets — derived from the scope-filtered set so
   *  the captain only sees their own execs and admin sees all execs. */
  execFacets: Array<{ id: string; name: string }>;
  /** Aggregate counts BEFORE pagination (across the filtered set). */
  aggregate: {
    total: number;
    pending: number;
    postponed: number;
    completed: number;
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(s: string | null | undefined): s is string {
  return typeof s === 'string' && ISO_DATE_RE.test(s);
}

function scopeWhere(scope: TasksTableScope): SQL | undefined {
  if (scope.kind === 'exec') return eq(tasks.execUserId, scope.execUserId);
  if (scope.kind === 'captain') {
    return sql`${tasks.execUserId} IN (
      SELECT ${salesExecutives.userId}
      FROM ${salesExecutives}
      WHERE ${salesExecutives.captainUserId} = ${scope.captainUserId}
    )`;
  }
  return undefined;
}

export async function loadTasksTable(
  args: TasksTableArgs,
): Promise<TasksTableResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const requestedPage = Math.max(1, args.page ?? 1);
  const sortDir = args.sortDir ?? 'desc';
  const from = validIsoDate(args.from) ? args.from : null;
  const to = validIsoDate(args.to) ? args.to : null;
  const status = args.status;
  const search = args.search?.trim() ?? '';

  const completedAtIstDate = sql`(${tasks.completedAt} AT TIME ZONE 'Asia/Kolkata')::date`;

  // -------------------------------------------------------------------------
  // Date predicate per status. Pending/Postponed use task_date.
  // Completed uses completed_at-IST. `all` ORs them so the date filter
  // catches any row whose relevant date is in the window.
  // -------------------------------------------------------------------------
  const datePredicate = (() => {
    if (from === null && to === null) return undefined;
    const f = from ?? '1970-01-01';
    const t = to ?? '9999-12-31';
    if (status === 'completed') {
      return and(
        isNotNull(tasks.completedAt),
        gte(completedAtIstDate, f),
        lte(completedAtIstDate, t),
      );
    }
    if (status === 'all') {
      return or(
        and(gte(tasks.taskDate, f), lte(tasks.taskDate, t)),
        and(
          isNotNull(tasks.completedAt),
          gte(completedAtIstDate, f),
          lte(completedAtIstDate, t),
        ),
      );
    }
    // pending / postponed → task_date
    return and(gte(tasks.taskDate, f), lte(tasks.taskDate, t));
  })();

  const statusPredicate =
    status === 'all' ? undefined : eq(tasks.status, status);

  const execFilterPredicate = args.execUserId
    ? eq(tasks.execUserId, args.execUserId)
    : undefined;

  // For captain filter, narrow tasks.exec_user_id to that captain's execs.
  // Skip for captain scope (already scoped) — admin/global only uses this.
  const captainFilterPredicate = args.captainUserId
    ? sql`${tasks.execUserId} IN (
        SELECT ${salesExecutives.userId}
        FROM ${salesExecutives}
        WHERE ${salesExecutives.captainUserId} = ${args.captainUserId}
      )`
    : undefined;

  // Free-text search: against description (always present) + linked
  // customer name (via LEFT JOIN'd visitRequests OR leads).
  const searchPredicate =
    search.length > 0
      ? or(
          ilike(tasks.description, `%${search}%`),
          ilike(visitRequests.customerName, `%${search}%`),
          ilike(leads.name, `%${search}%`),
        )
      : undefined;

  const whereClause = and(
    scopeWhere(args.scope),
    statusPredicate,
    datePredicate,
    execFilterPredicate,
    captainFilterPredicate,
    searchPredicate,
  );

  // -------------------------------------------------------------------------
  // Sort axis: completed → completed_at; else task_date.
  // -------------------------------------------------------------------------
  const sortDirFn = sortDir === 'asc' ? asc : desc;
  const sortColumn =
    status === 'completed' ? tasks.completedAt : tasks.taskDate;
  const orderBy = [
    sortDirFn(sortColumn),
    sortDirFn(tasks.createdAt),
  ];

  // -------------------------------------------------------------------------
  // Aggregate counts (across the FILTERED set — same predicates minus
  // the status one, so the strip can show how many of each kind
  // matched).
  // -------------------------------------------------------------------------
  const aggregateWhere = and(
    scopeWhere(args.scope),
    datePredicate,
    execFilterPredicate,
    captainFilterPredicate,
    searchPredicate,
  );
  const aggregateRows = await db
    .select({
      status: tasks.status,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(tasks)
    .leftJoin(visitRequests, eq(visitRequests.id, tasks.linkRequestId))
    .leftJoin(leads, eq(leads.id, tasks.linkLeadId))
    .where(aggregateWhere)
    .groupBy(tasks.status);

  const aggregate = {
    total: 0,
    pending: 0,
    postponed: 0,
    completed: 0,
  };
  for (const r of aggregateRows) {
    aggregate.total += r.cnt ?? 0;
    if (r.status === 'pending') aggregate.pending = r.cnt ?? 0;
    else if (r.status === 'postponed') aggregate.postponed = r.cnt ?? 0;
    else if (r.status === 'completed') aggregate.completed = r.cnt ?? 0;
  }

  // -------------------------------------------------------------------------
  // Main page query.
  // -------------------------------------------------------------------------
  const offset = (requestedPage - 1) * pageSize;
  const totalForStatus =
    status === 'all'
      ? aggregate.total
      : status === 'pending'
        ? aggregate.pending
        : status === 'postponed'
          ? aggregate.postponed
          : aggregate.completed;
  const totalPages = Math.max(1, Math.ceil(totalForStatus / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const clampedOffset = (page - 1) * pageSize;

  const rows = await db
    .select({
      id: tasks.id,
      taskType: tasks.taskType,
      description: tasks.description,
      status: tasks.status,
      taskDate: tasks.taskDate,
      completedAt: tasks.completedAt,
      postponedToDate: tasks.postponedToDate,
      estimatedTime: tasks.estimatedTime,
      outcomeName: outcomeOptions.name,
      outcomeNotes: tasks.outcomeNotes,
      execUserId: tasks.execUserId,
      execName: users.fullName,
      linkRequestId: tasks.linkRequestId,
      linkLeadId: tasks.linkLeadId,
      linkedCustomerNameFromRequest: visitRequests.customerName,
      linkedCustomerNameFromLead: leads.name,
      captainUserId: salesExecutives.captainUserId,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.execUserId))
    .leftJoin(salesExecutives, eq(salesExecutives.userId, tasks.execUserId))
    .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
    .leftJoin(visitRequests, eq(visitRequests.id, tasks.linkRequestId))
    .leftJoin(leads, eq(leads.id, tasks.linkLeadId))
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset(clampedOffset);

  // Captain name lookup (separate roundtrip — keeps the join graph
  // small).
  const captainIds = Array.from(
    new Set(
      rows
        .map((r) => r.captainUserId)
        .filter((x): x is string => !!x),
    ),
  );
  let captainNameById = new Map<string, string>();
  if (captainIds.length > 0) {
    const captainRows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, captainIds));
    captainNameById = new Map(captainRows.map((c) => [c.id, c.name ?? '—']));
  }

  const mappedRows: TasksTableRow[] = rows.map((r) => {
    const completedIstDate = r.completedAt
      ? new Date(r.completedAt).toLocaleDateString('en-CA', {
          timeZone: 'Asia/Kolkata',
        })
      : null;
    return {
      id: r.id,
      taskType: r.taskType,
      description: r.description,
      status: r.status as TasksTableRow['status'],
      taskDate: r.taskDate,
      completedAt:
        r.completedAt instanceof Date
          ? r.completedAt.toISOString()
          : r.completedAt,
      postponedToDate: r.postponedToDate,
      estimatedTime: r.estimatedTime,
      outcomeName: r.outcomeName,
      outcomeNotes: r.outcomeNotes,
      execUserId: r.execUserId,
      execName: r.execName ?? '—',
      captainUserId: r.captainUserId,
      captainName: r.captainUserId
        ? captainNameById.get(r.captainUserId) ?? '—'
        : null,
      linkedCustomerName:
        r.linkedCustomerNameFromRequest ?? r.linkedCustomerNameFromLead,
      linkRequestId: r.linkRequestId,
      linkLeadId: r.linkLeadId,
      primaryDate:
        r.status === 'completed' && completedIstDate
          ? completedIstDate
          : r.taskDate,
    };
  });

  // -------------------------------------------------------------------------
  // Facet dropdowns. Captain facets only meaningful for admin scope.
  // Exec facets derive from the scope-narrowed exec set.
  // -------------------------------------------------------------------------
  let captainFacets: Array<{ id: string; name: string }> = [];
  let execFacets: Array<{ id: string; name: string }> = [];

  if (args.scope.kind === 'global') {
    const captainRows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.role, 'captain'), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
    captainFacets = captainRows.map((c) => ({
      id: c.id,
      name: c.name ?? '—',
    }));

    const execRows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(and(eq(users.role, 'sales_executive'), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));
    execFacets = execRows.map((e) => ({ id: e.id, name: e.name ?? '—' }));
  } else if (args.scope.kind === 'captain') {
    const execRows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
      .where(
        and(
          eq(users.isActive, true),
          eq(salesExecutives.captainUserId, args.scope.captainUserId),
        ),
      )
      .orderBy(asc(users.fullName));
    execFacets = execRows.map((e) => ({ id: e.id, name: e.name ?? '—' }));
  }

  return {
    rows: mappedRows,
    total: totalForStatus,
    totalPages,
    page,
    pageSize,
    captainFacets,
    execFacets,
    aggregate,
  };
}
