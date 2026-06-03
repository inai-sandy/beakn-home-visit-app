import { and, asc, eq } from 'drizzle-orm';

import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/lists/Pagination';
import { RequestBucketTabs } from '@/components/requests/RequestBucketTabs';
import { RequestCardMobile } from '@/components/requests/RequestCardMobile';
import { RequestsTable } from '@/components/requests/RequestsTable';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  BUCKET_LABELS,
  CAPTAIN_REQUEST_BUCKETS,
  isCaptainRequestBucket,
  type CaptainRequestBucket,
} from '@/lib/captain/request-buckets';
import { fetchCaptainRequests } from '@/lib/captain/requests-queries';
import { buildListUrl, computePageRange, parsePage } from '@/lib/pagination';

import { RequestsFilterClient } from '@/app/(captain)/captain/requests/_components/RequestsFilterClient';

// Full mirror of /captain/requests scoped to URL captainId. Buckets +
// filters + table identical. InlineAssign action button intentionally
// omitted — admin view is read-only.

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    bucket?: string;
    city?: string;
    exec?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function AdminPortalRequestsPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = (await params) as { captainId: string };
  const sp = await searchParams;
  const activeBucket: CaptainRequestBucket = isCaptainRequestBucket(sp.bucket)
    ? sp.bucket
    : 'all';
  const q = (sp.q ?? '').trim();
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const page = parsePage(sp.page);
  const basePath = `/admin/portal/${captainId}/requests`;

  const myCities = await loadCaptainCities(captainId);
  const myCityIds = myCities.map((c) => c.id);

  if (myCityIds.length === 0) {
    return (
      <div className="p-4 sm:p-8 max-w-5xl space-y-3">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        </header>
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            This captain has no city assignments.
          </p>
        </div>
      </div>
    );
  }

  const safeCityFilter =
    cityFilter && myCityIds.includes(cityFilter) ? cityFilter : undefined;

  const { rows, total, bucketCounts } = await fetchCaptainRequests({
    captainUserId: captainId,
    cityIds: myCityIds,
    isSuperAdmin: false,
    bucket: activeBucket,
    search: q || undefined,
    cityFilter: safeCityFilter,
    execFilter,
    page,
  });

  const execOptions: Array<{ id: string; name: string }> = await db
    .select({ id: users.id, name: users.fullName })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));

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
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} request{total === 1 ? '' : 's'} across{' '}
            {myCities.length} {myCities.length === 1 ? 'city' : 'cities'}.
          </p>
        </div>
        {myCities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {myCities.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-xs">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </header>

      <RequestsFilterClient
        cityOptions={myCities}
        execOptions={execOptions}
        initial={{
          q,
          city: safeCityFilter ?? 'all',
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
            {q || safeCityFilter || execFilter
              ? 'No requests match the current filters.'
              : activeBucket === 'all'
                ? 'No requests in these cities yet.'
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
