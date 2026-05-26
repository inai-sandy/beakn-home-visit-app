import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities, statusStages, users, visitRequests } from '@/db/schema';
import {
  BUCKET_CASE_SQL,
  bucketWhereClause,
  emptyBucketCounts,
  type CaptainRequestBucket,
} from '@/lib/captain/request-buckets';
import { buildCaptainRequestVisibilityWhere } from '@/lib/captain/team-scope';
import { computePageRange, DEFAULT_PAGE_SIZE } from '@/lib/pagination';

import type { RequestRow } from '@/components/requests/types';

// =============================================================================
// HVA-153: server-side filter + pagination for /captain/requests
// =============================================================================
//
// Scope predicate is built once (`buildRequestsScopeWhere`) and reused
// across:
//
//   - the paginated row query (rows + total count)
//   - the bucket-count rollup (independent of which bucket is active)
//
// Per HVA-153 D6, the bucket-count chips on the tab strip stay
// independent of the active bucket so the captain always sees the full
// bucket distribution. Active bucket only narrows the rows query.
//
// Search semantics mirror the contacts page: ILIKE substring on customer
// name / phone (digit-only) / city name.
// =============================================================================

export interface FetchRequestsParams {
  /** Captain's own user id (used for team-scope visibility). */
  captainUserId?: string;
  /** Captain's city scope — used as the unaccepted-but-pending-in-my-cities
   *  fallback in the team-scope visibility helper. Pass [] for super_admin
   *  (skips the scope filter entirely). */
  cityIds: string[];
  isSuperAdmin: boolean;
  bucket: CaptainRequestBucket;
  search?: string;
  /** City id narrow — must be in cityIds for captain (defence-in-depth gated by the page). */
  cityFilter?: string;
  /** Assigned exec narrow. */
  execFilter?: string;
  page?: number;
  pageSize?: number;
}

export interface FetchRequestsResult {
  rows: RequestRow[];
  total: number;
  bucketCounts: Record<CaptainRequestBucket, number>;
}

export async function fetchCaptainRequests(
  params: FetchRequestsParams,
): Promise<FetchRequestsResult> {
  // Super-admin with no city scope = unfiltered; captain with no cities
  // = nothing visible.
  if (!params.isSuperAdmin && params.cityIds.length === 0) {
    return {
      rows: [],
      total: 0,
      bucketCounts: { ...emptyBucketCounts(), all: 0 },
    };
  }

  const scopeWhere = buildRequestsScopeWhere(params);
  const bucketWhere = bucketWhereClause(params.bucket);
  const composed = and(scopeWhere, bucketWhere);

  const execUser = alias(users, 'exec_user');

  const [[totalRow], rawBucketCounts] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(visitRequests)
      .innerJoin(cities, eq(cities.id, visitRequests.cityId))
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(composed),
    // D6: bucket counts ignore the active bucket selector — same scope,
    // GROUP BY bucket CASE.
    db
      .select({
        bucket: BUCKET_CASE_SQL.as('bucket'),
        count: sql<number>`count(*)::int`,
      })
      .from(visitRequests)
      .innerJoin(cities, eq(cities.id, visitRequests.cityId))
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(scopeWhere)
      .groupBy(BUCKET_CASE_SQL),
  ]);

  const total = totalRow?.count ?? 0;
  const range = computePageRange({
    total,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE,
  });

  const rowsRaw =
    total === 0
      ? []
      : await db
          .select({
            id: visitRequests.id,
            customerName: visitRequests.customerName,
            customerPhone: visitRequests.customerPhone,
            cityName: cities.name,
            statusCode: statusStages.code,
            statusName: statusStages.name,
            assignedExecUserId: visitRequests.assignedExecUserId,
            assignedExecName: execUser.fullName,
            cancelledAt: visitRequests.cancelledAt,
            createdAt: visitRequests.createdAt,
          })
          .from(visitRequests)
          .innerJoin(cities, eq(cities.id, visitRequests.cityId))
          .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
          .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
          .where(composed)
          .orderBy(desc(visitRequests.createdAt))
          .limit(range.pageSize)
          .offset(range.offset);

  const rows: RequestRow[] = rowsRaw.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    cityName: r.cityName,
    statusCode: r.statusCode,
    statusName: r.statusName,
    assignedExecUserId: r.assignedExecUserId,
    assignedExecName: r.assignedExecName,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
  }));

  const bucketCounts = emptyBucketCounts();
  let allCount = 0;
  for (const c of rawBucketCounts) {
    const key = c.bucket as CaptainRequestBucket;
    bucketCounts[key] = c.count;
    allCount += c.count;
  }
  bucketCounts.all = allCount;

  return { rows, total, bucketCounts };
}

/**
 * Exposed for tests so the SQL composition can be asserted without
 * hitting the DB. Also reused by `fetchCaptainRequests` so the bucket
 * count rollup uses the *exact* same scope filter as the row query.
 */
export function buildRequestsScopeWhere(params: {
  captainUserId?: string;
  cityIds: string[];
  isSuperAdmin: boolean;
  search?: string;
  cityFilter?: string;
  execFilter?: string;
}) {
  const clauses: ReturnType<typeof eq>[] = [];

  // 2026-05-26 team-scope: captain sees requests they accepted
  // (assigned_captain_user_id = me) PLUS unassigned-but-pending-in-my-
  // cities (so newly submitted requests in owned cities are still
  // discoverable). City-only matches where another captain accepted
  // are excluded. Super_admin remains unscoped. Legacy callers
  // (existing tests) that don't supply captainUserId fall back to
  // pure city scope so we don't break the test surface.
  if (!params.isSuperAdmin) {
    if (params.captainUserId) {
      clauses.push(
        buildCaptainRequestVisibilityWhere(params.captainUserId, {
          captainCityIds: params.cityIds,
        }),
      );
    } else {
      clauses.push(inArray(visitRequests.cityId, params.cityIds));
    }
  }

  if (params.cityFilter) {
    clauses.push(eq(visitRequests.cityId, params.cityFilter));
  }
  if (params.execFilter) {
    clauses.push(eq(visitRequests.assignedExecUserId, params.execFilter));
  }

  const trimmed = params.search?.trim() ?? '';
  if (trimmed.length > 0) {
    const needle = `%${trimmed}%`;
    const digits = trimmed.replace(/\D/g, '');
    const ors: ReturnType<typeof ilike>[] = [
      ilike(visitRequests.customerName, needle),
      ilike(cities.name, needle),
    ];
    if (digits.length > 0) {
      ors.push(ilike(visitRequests.customerPhone, `%${digits}%`));
    }
    const orClause = or(...ors);
    if (orClause) clauses.push(orClause);
  }

  return and(...clauses);
}

// re-exports — keeps page-level imports lean
export { isNotNull, isNull, ne };
