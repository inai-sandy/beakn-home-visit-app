import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/lists/Pagination';
import { RequestBucketTabs } from '@/components/requests/RequestBucketTabs';
import { RequestCardMobile } from '@/components/requests/RequestCardMobile';
import { RequestsTable } from '@/components/requests/RequestsTable';
import { db } from '@/db/client';
import { cities as citiesTable, salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  BUCKET_LABELS,
  CAPTAIN_REQUEST_BUCKETS,
  isCaptainRequestBucket,
  type CaptainRequestBucket,
} from '@/lib/captain/request-buckets';
import { fetchCaptainRequests } from '@/lib/captain/requests-queries';
import { buildListUrl, computePageRange, parsePage } from '@/lib/pagination';

import { RequestsFilterClient } from '@/app/(captain)/captain/requests/_components/RequestsFilterClient';

// =============================================================================
// /admin/operations/requests — global cross-team requests list
// =============================================================================
//
// Replaces the placeholder nav entry. Same shape as /captain/requests
// but with `isSuperAdmin: true` so the team-scope predicate is bypassed
// and every city's requests are surfaced.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'All Requests — Beakn admin',
};

interface PageProps {
  searchParams: Promise<{
    bucket?: string;
    city?: string;
    exec?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function AdminAllRequestsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/operations/requests');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  const sp = await searchParams;
  const activeBucket: CaptainRequestBucket = isCaptainRequestBucket(sp.bucket)
    ? sp.bucket
    : 'all';
  const q = (sp.q ?? '').trim();
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const page = parsePage(sp.page);
  const basePath = '/admin/operations/requests';

  // Cities + execs for the filter dropdowns — global scope.
  const [allCities, allExecs] = await Promise.all([
    db
      .select({ id: citiesTable.id, name: citiesTable.name })
      .from(citiesTable)
      .where(eq(citiesTable.isActive, true))
      .orderBy(asc(citiesTable.name)),
    db
      .select({ id: users.id, name: users.fullName })
      .from(salesExecutives)
      .innerJoin(users, eq(users.id, salesExecutives.userId))
      .where(eq(users.isActive, true))
      .orderBy(asc(users.fullName)),
  ]);

  const { rows, total, bucketCounts } = await fetchCaptainRequests({
    cityIds: [],
    isSuperAdmin: true,
    bucket: activeBucket,
    search: q || undefined,
    cityFilter,
    execFilter,
    page,
  });

  const bucketHrefByKey: Record<CaptainRequestBucket, string> = {
    all: buildListUrl(basePath, sp, { bucket: null }),
    open: buildListUrl(basePath, sp, { bucket: 'open' }),
    assigned: buildListUrl(basePath, sp, { bucket: 'assigned' }),
    completed: buildListUrl(basePath, sp, { bucket: 'completed' }),
    cancelled: buildListUrl(basePath, sp, { bucket: 'cancelled' }),
  };

  const bucketTabSpecs = CAPTAIN_REQUEST_BUCKETS.map((k) => ({
    key: k,
    label: BUCKET_LABELS[k],
    count: bucketCounts[k],
  }));

  const range = computePageRange({ total, page });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
          Operations
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
          All requests
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total} request{total === 1 ? '' : 's'} across all cities and teams.
        </p>
      </header>

      <RequestsFilterClient
        cityOptions={allCities}
        execOptions={allExecs}
        initial={{
          q,
          city: cityFilter ?? 'all',
          exec: execFilter ?? 'all',
        }}
      />

      <RequestBucketTabs
        buckets={bucketTabSpecs}
        active={activeBucket}
        hrefByKey={bucketHrefByKey}
      />

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {q || cityFilter || execFilter
              ? 'No requests match the current filters.'
              : activeBucket === 'all'
                ? 'No requests yet.'
                : `No ${BUCKET_LABELS[activeBucket].toLowerCase()} requests.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="lg:hidden space-y-3" aria-label="Requests (mobile)">
            {rows.map((r) => (
              <li key={r.id}>
                <RequestCardMobile row={r} mode="captain" />
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <RequestsTable rows={rows} mode="captain" />
          </div>
        </>
      )}

      {range.totalPages > 1 && (
        <Pagination
          pathname={basePath}
          page={range.page}
          totalPages={range.totalPages}
          from={range.from}
          to={range.to}
          total={range.total}
        />
      )}
    </div>
  );
}
