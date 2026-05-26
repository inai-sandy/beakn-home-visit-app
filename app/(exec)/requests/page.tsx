import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { cities, statusStages, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  EXEC_REQUEST_BUCKETS,
  IN_PROGRESS_STATUS_CODES,
  NEW_STATUS_CODES,
  TERMINAL_POSITIVE_STATUS_CODES,
  isExecRequestBucket,
  type ExecRequestBucket,
} from '@/lib/exec/request-buckets';
import { computePageRange, parsePage } from '@/lib/pagination';

import {
  RequestsFilterClient,
  type SerializedRequestRow,
} from './_components/RequestsFilterClient';

// =============================================================================
// HVA-65 + 2026-05-26 server-side pagination + filter
// =============================================================================
//
// Previously this page loaded every assigned request into the client and
// the bucket tabs + search input filtered in memory. That breaks at 500+
// rows and breaks the universal "10 records per page" rule. Server-side
// now does the WHERE + LIMIT/OFFSET; the client just renders + pushes
// URL changes.
//
// Bucket → status_code WHERE mapping mirrors lib/exec/request-buckets.ts.
// Counts use a single GROUP-BY pass so the bucket pills stay accurate
// regardless of the active filter (locked decision #8 carries forward).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Requests — Beakn',
  description: 'Your assigned requests.',
};

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string; bucket?: string }>;
}

export default async function ExecRequestsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/requests');
  }

  const user = session.user as { id: string; role?: string };

  if (user.role === 'captain') {
    redirect('/captain/requests');
  }
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const raw = await searchParams;
  const page = parsePage(raw.page);
  const search = (raw.q ?? '').trim();
  const bucket: ExecRequestBucket = isExecRequestBucket(raw.bucket)
    ? raw.bucket
    : 'all';

  const execAssigned = eq(visitRequests.assignedExecUserId, user.id);

  function bucketPredicate(b: ExecRequestBucket) {
    if (b === 'cancelled') return isNotNull(visitRequests.cancelledAt);
    if (b === 'completed') {
      return and(
        isNull(visitRequests.cancelledAt),
        inArray(statusStages.code, [...TERMINAL_POSITIVE_STATUS_CODES]),
      );
    }
    if (b === 'in_progress') {
      return and(
        isNull(visitRequests.cancelledAt),
        inArray(statusStages.code, [...IN_PROGRESS_STATUS_CODES]),
      );
    }
    if (b === 'new') {
      return and(
        isNull(visitRequests.cancelledAt),
        inArray(statusStages.code, [...NEW_STATUS_CODES]),
      );
    }
    return undefined;
  }

  const searchTerm = search.length > 0 ? search.toLowerCase() : null;
  const searchPredicate = searchTerm
    ? sql`(LOWER(${visitRequests.customerName}) LIKE ${`%${searchTerm}%`}
          OR LOWER(${visitRequests.customerPhone}) LIKE ${`%${searchTerm}%`})`
    : undefined;

  const where = and(execAssigned, bucketPredicate(bucket), searchPredicate);

  // Count per bucket (unfiltered by bucket, still filtered by search +
  // exec scope) so the pills reflect the full picture under the current
  // search term.
  const countRows = await db
    .select({
      isCancelled: sql<boolean>`${visitRequests.cancelledAt} IS NOT NULL`,
      code: statusStages.code,
      total: sql<number>`COUNT(*)::int`,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(and(execAssigned, searchPredicate))
    .groupBy(
      sql`${visitRequests.cancelledAt} IS NOT NULL`,
      statusStages.code,
    );

  const counts: Record<ExecRequestBucket, number> = {
    all: 0,
    new: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const row of countRows) {
    counts.all += row.total;
    if (row.isCancelled) {
      counts.cancelled += row.total;
      continue;
    }
    if (TERMINAL_POSITIVE_STATUS_CODES.includes(row.code)) {
      counts.completed += row.total;
    } else if (IN_PROGRESS_STATUS_CODES.includes(row.code)) {
      counts.in_progress += row.total;
    } else {
      counts.new += row.total;
    }
  }

  const total = counts[bucket];
  const pageRange = computePageRange({ total, page });

  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      statusCode: statusStages.code,
      statusName: statusStages.name,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cancelledAt: visitRequests.cancelledAt,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(where)
    .orderBy(desc(visitRequests.createdAt))
    .limit(pageRange.pageSize)
    .offset(pageRange.offset);

  const serialized: SerializedRequestRow[] = rows.map((r) => ({
    ...r,
    cancelledAt: r.cancelledAt === null ? null : r.cancelledAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {counts.all === 0
              ? 'No assignments yet.'
              : `${counts.all} assigned ${counts.all === 1 ? 'request' : 'requests'} across all buckets.`}
          </p>
        </header>

        <RequestsFilterClient
          rows={serialized}
          counts={counts}
          currentBucket={bucket}
          currentSearch={search}
          pageRange={pageRange}
        />
      </div>
    </main>
  );
}

// Re-export the bucket list so future filter helpers can consume it
// without adding a separate import.
export { EXEC_REQUEST_BUCKETS };
