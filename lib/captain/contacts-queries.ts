import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  businessTypes,
  cities,
  leads,
  quotations,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { computePageRange, DEFAULT_PAGE_SIZE } from '@/lib/pagination';

// =============================================================================
// HVA-73 PR 2: captain-scoped contact reads
// =============================================================================
//
// All queries gate on the captain's team membership (sales_executives
// where captain_user_id = currentCaptain.id, joined to active users).
// super_admin can pass `teamUserIds` directly when assisting (the route
// wrapper resolves the city's owning captain's team).
//
// Returns rows already serialised for the page renderer: dates as ISO
// strings, optional joins flattened, request counts pre-aggregated.
// =============================================================================

export interface TeamContactRow {
  id: string;
  type: string;
  name: string;
  phone: string;
  email: string | null;
  cityId: string;
  cityName: string;
  bhk: string | null;
  firmName: string | null;
  businessTypeId: string | null;
  businessTypeName: string | null;
  interest: string[];
  notes: string | null;
  capturedByUserId: string;
  capturedByName: string | null;
  capturedDate: string;
  createdAt: string;
  convertedToRequestId: string | null;
  convertedAt: string | null;
  requestCount: number;
}

export interface TeamExecOption {
  id: string;
  name: string;
}

export async function loadCaptainTeamUserIds(
  captainUserId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: salesExecutives.userId })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    );
  return rows.map((r) => r.userId);
}

export async function loadCaptainTeamExecOptions(
  captainUserId: string,
): Promise<TeamExecOption[]> {
  return db
    .select({ id: users.id, name: users.fullName })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));
}

export interface FetchTeamContactsParams {
  teamUserIds: string[];
  search?: string;
  typeFilter?: 'Customer' | 'Business';
  /** Captor's user id — when set, narrows to a single team exec. */
  execFilter?: string;
  page?: number;
  pageSize?: number;
}

export interface FetchTeamContactsResult {
  rows: TeamContactRow[];
  total: number;
}

/**
 * HVA-153: server-side filtered + paginated team contacts.
 *
 * Filter composition:
 *   - team scope: `leads.captured_by_user_id IN teamUserIds`
 *   - exec narrow (optional): the above narrowed to a single captor
 *   - type narrow (optional): `leads.type = ?`
 *   - search (optional): OR over name / city name / firm name /
 *     digit-only phone substring
 *
 * Two round-trips: paginated rows + matching total. The request-count
 * aggregate runs as a third round-trip but is scoped to the **visible
 * page's lead ids only** (D3 from the bundle) so we don't load N counts
 * to render 20.
 */
export async function fetchTeamContacts(
  params: FetchTeamContactsParams,
): Promise<FetchTeamContactsResult> {
  const { teamUserIds } = params;
  if (teamUserIds.length === 0) return { rows: [], total: 0 };

  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  // Compose the predicate once; reuse for both the rows query and the
  // total-count query so they can't drift.
  const conditions = buildContactsWhere({
    teamUserIds,
    search: params.search,
    typeFilter: params.typeFilter,
    execFilter: params.execFilter,
  });

  const captorAlias = users;

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .innerJoin(cities, eq(cities.id, leads.cityId))
    .innerJoin(captorAlias, eq(captorAlias.id, leads.capturedByUserId))
    .where(conditions);
  const total = totalRow?.count ?? 0;

  const range = computePageRange({ total, page: params.page ?? 1, pageSize });

  const baseRows =
    total === 0
      ? []
      : await db
          .select({
            id: leads.id,
            type: leads.type,
            name: leads.name,
            phone: leads.phone,
            email: leads.email,
            cityId: leads.cityId,
            cityName: cities.name,
            bhk: leads.bhk,
            firmName: leads.firmName,
            businessTypeId: leads.businessTypeId,
            businessTypeName: businessTypes.name,
            interest: leads.interest,
            notes: leads.notes,
            capturedByUserId: leads.capturedByUserId,
            capturedByName: captorAlias.fullName,
            capturedDate: leads.capturedDate,
            createdAt: leads.createdAt,
            convertedToRequestId: leads.convertedToRequestId,
            convertedAt: leads.convertedAt,
          })
          .from(leads)
          .innerJoin(cities, eq(cities.id, leads.cityId))
          .leftJoin(businessTypes, eq(businessTypes.id, leads.businessTypeId))
          .innerJoin(captorAlias, eq(captorAlias.id, leads.capturedByUserId))
          .where(conditions)
          .orderBy(
            // HVA-153: unconverted first, then newest within each group.
            // Postgres default for `ORDER BY uuid_col ASC` is NULLS LAST,
            // which is the opposite of what we want — so use an explicit
            // boolean expression: `(col IS NOT NULL) ASC` puts FALSE
            // (i.e. unconverted) first.
            sql`${leads.convertedToRequestId} IS NOT NULL ASC`,
            desc(leads.createdAt),
          )
          .limit(range.pageSize)
          .offset(range.offset);

  // Request-count aggregate — scope to the visible page only (HVA-153 D3).
  const visibleIds = baseRows.map((r) => r.id);
  const countMap = new Map<string, number>();
  if (visibleIds.length > 0) {
    const counts = await db
      .select({
        contactId: visitRequests.contactId,
        count: sql<number>`count(*)::int`,
      })
      .from(visitRequests)
      .where(inArray(visitRequests.contactId, visibleIds))
      .groupBy(visitRequests.contactId);
    for (const c of counts) {
      if (c.contactId) countMap.set(c.contactId, c.count);
    }
  }

  // Legacy patch (HVA-73 PR 1): convertedToRequestId set but the linked
  // request has NULL contact_id (pre-PR-1 conversion that never got
  // backfilled). Promote to count=1 so the row still surfaces "1 request".
  for (const r of baseRows) {
    if (r.convertedToRequestId && !countMap.has(r.id)) {
      countMap.set(r.id, 1);
    }
  }

  const rows = baseRows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    phone: r.phone,
    email: r.email,
    cityId: r.cityId,
    cityName: r.cityName,
    bhk: r.bhk,
    firmName: r.firmName,
    businessTypeId: r.businessTypeId,
    businessTypeName: r.businessTypeName,
    interest: r.interest,
    notes: r.notes,
    capturedByUserId: r.capturedByUserId,
    capturedByName: r.capturedByName ?? null,
    capturedDate: r.capturedDate,
    createdAt: r.createdAt.toISOString(),
    convertedToRequestId: r.convertedToRequestId,
    convertedAt: r.convertedAt ? r.convertedAt.toISOString() : null,
    requestCount: countMap.get(r.id) ?? 0,
  }));

  return { rows, total };
}

/**
 * Shared predicate builder. Exposed so tests can verify the SQL
 * composition without hitting the DB; also used by both the rows query
 * and the total-count query above.
 */
export function buildContactsWhere(params: {
  teamUserIds: string[];
  search?: string;
  typeFilter?: 'Customer' | 'Business';
  execFilter?: string;
}) {
  const clauses: ReturnType<typeof eq>[] = [];

  // Team scope. If an execFilter is supplied, narrow to that single id
  // (still defence-in-depth gated against team membership by the page).
  if (params.execFilter) {
    clauses.push(eq(leads.capturedByUserId, params.execFilter));
  } else {
    clauses.push(inArray(leads.capturedByUserId, params.teamUserIds));
  }

  if (params.typeFilter) {
    clauses.push(eq(leads.type, params.typeFilter));
  }

  const trimmed = params.search?.trim() ?? '';
  if (trimmed.length > 0) {
    const needle = `%${trimmed}%`;
    const digits = trimmed.replace(/\D/g, '');
    const ors: ReturnType<typeof ilike>[] = [
      ilike(leads.name, needle),
      ilike(cities.name, needle),
      ilike(leads.firmName, needle),
    ];
    if (digits.length > 0) {
      ors.push(ilike(leads.phone, `%${digits}%`));
    }
    const orClause = or(...ors);
    if (orClause) clauses.push(orClause);
  }

  return and(...clauses);
}

export interface TeamContactDetail extends TeamContactRow {
  // Same shape as TeamContactRow today; kept as a distinct type so PR 3
  // can extend the detail-page result without touching list callers.
}

export async function fetchTeamContactById(
  contactId: string,
  teamUserIds: string[],
): Promise<TeamContactDetail | null> {
  if (teamUserIds.length === 0) return null;
  const captorAlias = users;
  const [row] = await db
    .select({
      id: leads.id,
      type: leads.type,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      cityId: leads.cityId,
      cityName: cities.name,
      bhk: leads.bhk,
      firmName: leads.firmName,
      businessTypeId: leads.businessTypeId,
      businessTypeName: businessTypes.name,
      interest: leads.interest,
      notes: leads.notes,
      capturedByUserId: leads.capturedByUserId,
      capturedByName: captorAlias.fullName,
      capturedDate: leads.capturedDate,
      createdAt: leads.createdAt,
      convertedToRequestId: leads.convertedToRequestId,
      convertedAt: leads.convertedAt,
    })
    .from(leads)
    .innerJoin(cities, eq(cities.id, leads.cityId))
    .leftJoin(businessTypes, eq(businessTypes.id, leads.businessTypeId))
    .innerJoin(captorAlias, eq(captorAlias.id, leads.capturedByUserId))
    .where(
      and(
        eq(leads.id, contactId),
        inArray(leads.capturedByUserId, teamUserIds),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Drive the requestCount the same way as the list query for parity.
  let requestCount = 0;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(visitRequests)
    .where(eq(visitRequests.contactId, contactId));
  requestCount = countRow?.count ?? 0;
  if (requestCount === 0 && row.convertedToRequestId) {
    requestCount = 1;
  }

  return {
    id: row.id,
    type: row.type,
    name: row.name,
    phone: row.phone,
    email: row.email,
    cityId: row.cityId,
    cityName: row.cityName,
    bhk: row.bhk,
    firmName: row.firmName,
    businessTypeId: row.businessTypeId,
    businessTypeName: row.businessTypeName,
    interest: row.interest,
    notes: row.notes,
    capturedByUserId: row.capturedByUserId,
    capturedByName: row.capturedByName ?? null,
    capturedDate: row.capturedDate,
    createdAt: row.createdAt.toISOString(),
    convertedToRequestId: row.convertedToRequestId,
    convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
    requestCount,
  };
}

export interface TeamContactRequest {
  id: string;
  customerName: string;
  cityName: string;
  statusStageCode: string;
  statusStageName: string;
  assignedExecName: string | null;
  totalAmountPaise: number | null;
  createdAt: string;
}

export async function fetchTeamContactRequests(
  contactId: string,
  convertedToRequestId: string | null,
): Promise<TeamContactRequest[]> {
  const execAlias = users;
  const whereExpr =
    convertedToRequestId !== null
      ? or(
          eq(visitRequests.contactId, contactId),
          eq(visitRequests.id, convertedToRequestId),
        )
      : eq(visitRequests.contactId, contactId);

  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
      assignedExecName: execAlias.fullName,
      totalAmountPaise: quotations.totalOrderValuePaise,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(execAlias, eq(execAlias.id, visitRequests.assignedExecUserId))
    .leftJoin(
      quotations,
      and(
        eq(quotations.visitRequestId, visitRequests.id),
        // HVA-281: show the CartPlus actual; manual rows are targets.
        eq(quotations.source, 'portal'),
      ),
    )
    .where(whereExpr)
    .orderBy(desc(visitRequests.createdAt));

  return rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    cityName: r.cityName,
    statusStageCode: r.statusStageCode,
    statusStageName: r.statusStageName,
    assignedExecName: r.assignedExecName ?? null,
    totalAmountPaise: r.totalAmountPaise ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// `isNull` is re-exported for the page-level OR construction; pulling it
// into the queries module keeps the page imports tighter.
export const _drizzleExprs = { isNull };
