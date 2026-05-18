import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { RequestBucketTabs } from '@/components/requests/RequestBucketTabs';
import { RequestCardMobile } from '@/components/requests/RequestCardMobile';
import { RequestsTable } from '@/components/requests/RequestsTable';
import type { RequestRow } from '@/components/requests/types';
import { db } from '@/db/client';
import {
  cities,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  BUCKET_LABELS,
  CAPTAIN_REQUEST_BUCKETS,
  categorizeRequest,
  isCaptainRequestBucket,
  type CaptainRequestBucket,
} from '@/lib/captain/request-buckets';

import { InlineAssignButton } from './inline-assign-button';

// =============================================================================
// HVA-127: /captain/requests — all requests in the captain's cities
// =============================================================================
//
// Wide-net listing. Filter: `visit_requests.city_id IN (cities WHERE
// captain_user_id = me)`. No status filter at the query layer — bucket
// tabs operate client-rendering-side on the same row set so the captain
// always sees their full request volume on first load.
//
// AUTH:
//   - captain   → own-city requests, all statuses
//   - super_admin → all requests (skip the city filter)
//   - (captain layout's role gate keeps anyone else out)
//
// "Other" pseudo-city has `captain_user_id IS NULL`, so the inArray
// filter excludes it by construction. No captain ever sees Other-city
// requests in this list — by design.
//
// /captain/requests/unassigned remains as the narrower "pending-assign"
// queue (HVA-81). Same ownership rule, different status filter.
//
// HVA-65: rendering primitives extracted to components/requests/*
// (RequestBucketTabs / RequestsTable / RequestCardMobile). Bucket
// selection stays URL-driven (searchParams.bucket) so shareable URLs
// continue to land on the right tab — the exec page uses the same
// primitives in click-handler mode for its in-memory filter.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ bucket?: string }>;
}

export default async function CaptainRequestsListPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/requests');

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === 'super_admin';

  const { bucket: bucketRaw } = await searchParams;
  const activeBucket: CaptainRequestBucket = isCaptainRequestBucket(bucketRaw)
    ? bucketRaw
    : 'all';

  const myCities = isAdmin ? [] : await loadCaptainCities(actor.id);
  const myCityIds = myCities.map((c) => c.id);

  // Empty state for a captain with no city assignments. Skip the query
  // entirely — avoids returning everything via the absence of the
  // inArray filter on an empty list.
  if (!isAdmin && myCityIds.length === 0) {
    return (
      <div className="p-8 max-w-5xl space-y-3">
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

  const execUser = alias(users, 'exec_user');

  // Single query — JOIN cities for name, status_stages for human-readable
  // status, LEFT JOIN exec user for the assigned-to display.
  const rows: RequestRow[] = await db
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
    .where(isAdmin ? undefined : and(inArray(visitRequests.cityId, myCityIds)))
    .orderBy(desc(visitRequests.createdAt));

  // Bucket the rows in-memory. Counts feed the tab strip; filtering
  // happens after so the "All" count is always row total.
  const bucketCounts: Record<CaptainRequestBucket, number> = {
    all: rows.length,
    open: 0,
    assigned: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    bucketCounts[
      categorizeRequest({
        statusCode: r.statusCode,
        assignedExecUserId: r.assignedExecUserId,
        cancelledAt: r.cancelledAt,
      })
    ] += 1;
  }

  const visible =
    activeBucket === 'all'
      ? rows
      : rows.filter(
          (r) =>
            categorizeRequest({
              statusCode: r.statusCode,
              assignedExecUserId: r.assignedExecUserId,
              cancelledAt: r.cancelledAt,
            }) === activeBucket,
        );

  // HVA-139: load the captain's exec list once so any row that qualifies
  // for an inline Assign trigger can pass it down. Super_admin gets the
  // full active-exec list (they may assign across teams for support).
  // Captain gets only execs reporting to them.
  function rowQualifiesForInlineAssign(r: RequestRow): boolean {
    return (
      r.cancelledAt === null &&
      r.statusCode === 'SUBMITTED' &&
      r.assignedExecUserId === null
    );
  }

  const hasAssignableRow = visible.some(rowQualifiesForInlineAssign);
  const execsForAssignment: Array<{ id: string; fullName: string }> =
    hasAssignableRow
      ? isAdmin
        ? await db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
            .where(eq(users.isActive, true))
            .orderBy(asc(users.fullName))
        : await db
            .select({ id: users.id, fullName: users.fullName })
            .from(salesExecutives)
            .innerJoin(users, eq(users.id, salesExecutives.userId))
            .where(
              and(
                eq(salesExecutives.captainUserId, actor.id),
                eq(users.isActive, true),
              ),
            )
            .orderBy(asc(users.fullName))
      : [];

  function renderActions(row: RequestRow) {
    if (!rowQualifiesForInlineAssign(row)) return null;
    return (
      <InlineAssignButton requestId={row.id} execs={execsForAssignment} />
    );
  }

  const bucketTabSpecs = CAPTAIN_REQUEST_BUCKETS.map((k) => ({
    key: k,
    label: BUCKET_LABELS[k],
    count: bucketCounts[k],
  }));

  return (
    <div className="p-6 sm:p-8 max-w-6xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'All requests across every city.'
              : `${rows.length} request${rows.length === 1 ? '' : 's'} across ${myCities.length} ${myCities.length === 1 ? 'city' : 'cities'}.`}
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

      <RequestBucketTabs
        buckets={bucketTabSpecs}
        active={activeBucket}
        LinkComponent={Link}
        hrefFor={(k) =>
          k === 'all' ? '/captain/requests' : `/captain/requests?bucket=${k}`
        }
      />

      {visible.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {activeBucket === 'all'
              ? 'No requests in your cities yet.'
              : `No ${BUCKET_LABELS[activeBucket].toLowerCase()} requests.`}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards (< lg). Captain breakpoint stays at lg per HVA-127. */}
          <ul className="lg:hidden space-y-3" aria-label="Requests (mobile)">
            {visible.map((r) => (
              <li key={r.id}>
                <RequestCardMobile
                  row={r}
                  mode="captain"
                  renderActions={renderActions}
                />
              </li>
            ))}
          </ul>

          {/* Desktop table (≥ lg) */}
          <div className="hidden lg:block">
            <RequestsTable
              rows={visible}
              mode="captain"
              renderActions={renderActions}
            />
          </div>
        </>
      )}
    </div>
  );
}
