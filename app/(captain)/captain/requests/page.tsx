import { and, asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/lists/Pagination';
import { RequestBucketTabs } from '@/components/requests/RequestBucketTabs';
import { RequestCardMobile } from '@/components/requests/RequestCardMobile';
import { RequestsTable } from '@/components/requests/RequestsTable';
import type { RequestRow } from '@/components/requests/types';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  BUCKET_LABELS,
  CAPTAIN_REQUEST_BUCKETS,
  isCaptainRequestBucket,
  type CaptainRequestBucket,
} from '@/lib/captain/request-buckets';
import { fetchCaptainRequests } from '@/lib/captain/requests-queries';
import { buildListUrl, computePageRange, parsePage } from '@/lib/pagination';

import { InlineAssignButton } from './inline-assign-button';
import { RequestsFilterClient } from './_components/RequestsFilterClient';

// =============================================================================
// HVA-127 + HVA-153: /captain/requests — server-driven search + pagination
// =============================================================================
//
// All filter state lives in the URL: ?bucket=&city=&exec=&q=&page=.
// Bucket selection still drives the tab strip via RequestBucketTabs in
// Link mode (server-rendered href map). The new search input + city +
// exec dropdowns live in RequestsFilterClient which pushes URL updates
// on change.
//
// Bucket chip counts come from a separate GROUP-BY-CASE query that
// shares the scope predicate but ignores the active bucket itself
// (HVA-153 D6) so chip counts never depend on which tab is open.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    bucket?: string;
    city?: string;
    exec?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function CaptainRequestsListPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/requests');

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === 'super_admin';

  const params = await searchParams;
  const activeBucket: CaptainRequestBucket = isCaptainRequestBucket(
    params.bucket,
  )
    ? params.bucket
    : 'all';
  const q = (params.q ?? '').trim();
  const cityFilter = params.city && params.city !== 'all' ? params.city : undefined;
  const execFilter = params.exec && params.exec !== 'all' ? params.exec : undefined;
  const page = parsePage(params.page);

  const myCities = isAdmin ? [] : await loadCaptainCities(actor.id);
  const myCityIds = myCities.map((c) => c.id);

  // Empty state — captain with no city assignments.
  if (!isAdmin && myCityIds.length === 0) {
    return (
      <div className="p-4 sm:p-8 max-w-5xl space-y-3">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        </header>
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No requests in your cities yet. If you expected to see requests
            here, ask an admin to confirm your city assignments.
          </p>
        </div>
      </div>
    );
  }

  // Defence-in-depth: drop URL-supplied city/exec filters that aren't in
  // scope for this captain (silently — user sees the unfiltered list).
  const safeCityFilter =
    cityFilter && (isAdmin || myCityIds.includes(cityFilter))
      ? cityFilter
      : undefined;

  const { rows, total, bucketCounts } = await fetchCaptainRequests({
    cityIds: myCityIds,
    isSuperAdmin: isAdmin,
    bucket: activeBucket,
    search: q || undefined,
    cityFilter: safeCityFilter,
    execFilter,
    page,
  });

  // Load exec options for the filter dropdown + the InlineAssign button.
  // Super_admin → all active execs; captain → own team.
  const execOptions: Array<{ id: string; name: string }> = isAdmin
    ? await db
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
        .where(eq(users.isActive, true))
        .orderBy(asc(users.fullName))
    : await db
        .select({ id: users.id, name: users.fullName })
        .from(salesExecutives)
        .innerJoin(users, eq(users.id, salesExecutives.userId))
        .where(
          and(
            eq(salesExecutives.captainUserId, actor.id),
            eq(users.isActive, true),
          ),
        )
        .orderBy(asc(users.fullName));

  // Build bucket tab hrefs preserving every other filter. Switching
  // buckets is itself a filter change → drop ?page (handled by
  // buildListUrl's reset-on-non-page-override rule).
  const bucketHrefByKey: Record<CaptainRequestBucket, string> = {
    all: buildListUrl('/captain/requests', params, { bucket: null }),
    open: buildListUrl('/captain/requests', params, { bucket: 'open' }),
    assigned: buildListUrl('/captain/requests', params, { bucket: 'assigned' }),
    completed: buildListUrl('/captain/requests', params, {
      bucket: 'completed',
    }),
    cancelled: buildListUrl('/captain/requests', params, {
      bucket: 'cancelled',
    }),
  };

  const bucketTabSpecs = CAPTAIN_REQUEST_BUCKETS.map((k) => ({
    key: k,
    label: BUCKET_LABELS[k],
    count: bucketCounts[k],
  }));

  // Inline Assign trigger qualification + exec list (re-uses the dropdown
  // options when the active bucket might contain assignable rows).
  function rowQualifiesForInlineAssign(r: RequestRow): boolean {
    return (
      r.cancelledAt === null &&
      r.statusCode === 'SUBMITTED' &&
      r.assignedExecUserId === null
    );
  }
  const execsForAssignment = execOptions.map((e) => ({
    id: e.id,
    fullName: e.name,
  }));
  function renderActions(row: RequestRow) {
    if (!rowQualifiesForInlineAssign(row)) return null;
    return (
      <InlineAssignButton requestId={row.id} execs={execsForAssignment} />
    );
  }

  const range = computePageRange({ total, page });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'All requests across every city.'
              : `${total} request${total === 1 ? '' : 's'} across ${myCities.length} ${myCities.length === 1 ? 'city' : 'cities'}.`}
          </p>
        </div>
        {!isAdmin && myCities.length > 0 && (
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
                ? 'No requests in your cities yet.'
                : `No ${BUCKET_LABELS[activeBucket].toLowerCase()} requests.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="lg:hidden space-y-3" aria-label="Requests (mobile)">
            {rows.map((r) => (
              <li key={r.id}>
                <RequestCardMobile
                  row={r}
                  mode="captain"
                  renderActions={renderActions}
                />
              </li>
            ))}
          </ul>

          <div className="hidden lg:block">
            <RequestsTable
              rows={rows}
              mode="captain"
              renderActions={renderActions}
            />
          </div>
        </>
      )}

      {range.totalPages > 1 && (
        <Pagination
          pathname="/captain/requests"
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
