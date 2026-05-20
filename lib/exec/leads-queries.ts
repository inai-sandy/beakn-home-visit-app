import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  businessTypes,
  cities,
  leads,
  users,
  visitRequests,
} from '@/db/schema';
import {
  loadExecVisibleContactSet,
  type VisibleContactSet,
} from '@/lib/exec/visible-contacts';
import { computePageRange, DEFAULT_PAGE_SIZE } from '@/lib/pagination';

// =============================================================================
// HVA-153: server-side filter + pagination for the exec /leads list
// =============================================================================
//
// Scope source is HVA-161's `loadExecVisibleContactSet` (captor OR
// ever-assigned). The list query narrows further by:
//   - search (name / city / firm / digit-only phone)
//   - type filter ('Customer' | 'Business')
//
// The sort `(converted_to_request_id IS NOT NULL) ASC, created_at DESC`
// is preserved across pagination (HVA-153 D2) so unconverted contacts
// surface first regardless of which page you're on.
//
// Request-count aggregate runs against the paginated visible page only
// (HVA-153 D3).
// =============================================================================

export interface ExecLeadRow {
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
  visibilityReason: 'captor' | 'assignment';
}

export interface FetchExecLeadsParams {
  execUserId: string;
  search?: string;
  typeFilter?: 'Customer' | 'Business';
  page?: number;
  pageSize?: number;
}

export interface FetchExecLeadsResult {
  rows: ExecLeadRow[];
  total: number;
  visibility: VisibleContactSet;
}

export async function fetchExecLeads(
  params: FetchExecLeadsParams,
): Promise<FetchExecLeadsResult> {
  const visibility = await loadExecVisibleContactSet(params.execUserId);
  if (visibility.ids.length === 0) {
    return { rows: [], total: 0, visibility };
  }

  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = buildLeadsWhere({
    visibleIds: visibility.ids,
    search: params.search,
    typeFilter: params.typeFilter,
  });

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .innerJoin(cities, eq(cities.id, leads.cityId))
    .where(where);
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
            capturedByName: users.fullName,
            capturedDate: leads.capturedDate,
            createdAt: leads.createdAt,
            convertedToRequestId: leads.convertedToRequestId,
            convertedAt: leads.convertedAt,
          })
          .from(leads)
          .innerJoin(cities, eq(cities.id, leads.cityId))
          .leftJoin(businessTypes, eq(businessTypes.id, leads.businessTypeId))
          .innerJoin(users, eq(users.id, leads.capturedByUserId))
          .where(where)
          .orderBy(
            // HVA-153: unconverted first (Postgres default ASC is NULLS
            // LAST, so use a boolean expression to flip).
            sql`${leads.convertedToRequestId} IS NOT NULL ASC`,
            desc(leads.createdAt),
          )
          .limit(range.pageSize)
          .offset(range.offset);

  // Request counts — scoped to the visible page only (D3).
  const pageIds = baseRows.map((r) => r.id);
  const countMap = new Map<string, number>();
  if (pageIds.length > 0) {
    const counts = await db
      .select({
        contactId: visitRequests.contactId,
        count: sql<number>`count(*)::int`,
      })
      .from(visitRequests)
      .where(inArray(visitRequests.contactId, pageIds))
      .groupBy(visitRequests.contactId);
    for (const c of counts) {
      if (c.contactId) countMap.set(c.contactId, c.count);
    }
  }
  // Legacy patch: pre-PR1 conversions whose request has NULL contact_id.
  for (const r of baseRows) {
    if (r.convertedToRequestId && !countMap.has(r.id)) {
      countMap.set(r.id, 1);
    }
  }

  const rows: ExecLeadRow[] = baseRows.map((r) => ({
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
    visibilityReason: visibility.reasons.get(r.id) ?? 'assignment',
  }));

  return { rows, total, visibility };
}

/** Exposed for tests + reused across the rows and total queries. */
export function buildLeadsWhere(params: {
  visibleIds: string[];
  search?: string;
  typeFilter?: 'Customer' | 'Business';
}) {
  const clauses: ReturnType<typeof eq>[] = [
    inArray(leads.id, params.visibleIds),
  ];
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
