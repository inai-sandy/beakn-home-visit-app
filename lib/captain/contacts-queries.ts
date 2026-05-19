import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

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

export async function fetchTeamContacts(
  teamUserIds: string[],
): Promise<TeamContactRow[]> {
  if (teamUserIds.length === 0) return [];

  const captorAlias = users;
  const rows = await db
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
    .where(inArray(leads.capturedByUserId, teamUserIds))
    .orderBy(
      // Unconverted first within each captor; newest first within each
      // group. Same sort the exec /leads page uses.
      asc(leads.convertedToRequestId),
      desc(leads.createdAt),
    );

  // Aggregate request counts via visit_requests.contact_id. Includes
  // legacy converted_to_request_id pointer requests (whose contact_id
  // may still be NULL — no backfill per PR 1 D6).
  const leadIds = rows.map((r) => r.id);
  const convertedRequestIds = rows
    .map((r) => r.convertedToRequestId)
    .filter((v): v is string => v !== null);

  const countMap = new Map<string, number>();
  if (leadIds.length > 0) {
    const counts = await db
      .select({
        contactId: visitRequests.contactId,
        count: sql<number>`count(*)::int`,
      })
      .from(visitRequests)
      .where(inArray(visitRequests.contactId, leadIds))
      .groupBy(visitRequests.contactId);
    for (const c of counts) {
      if (c.contactId) countMap.set(c.contactId, c.count);
    }
  }

  // Legacy patch: a row with convertedToRequestId set but contact_id NULL
  // on that request should still show "≥1 request". We don't double-count
  // since contact_id-matched requests would dominate; for legacy-only
  // rows we promote the count to 1.
  if (convertedRequestIds.length > 0) {
    for (const r of rows) {
      if (
        r.convertedToRequestId &&
        !countMap.has(r.id)
      ) {
        countMap.set(r.id, 1);
      }
    }
  }

  return rows.map((r) => ({
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
    .leftJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
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
