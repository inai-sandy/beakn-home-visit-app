import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, ilike, isNull } from 'drizzle-orm';
import { formatDistanceToNow } from 'date-fns';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Pagination } from '@/components/lists/Pagination';
import { db } from '@/db/client';
import {
  cities,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { buildCaptainRequestVisibilityWhere } from '@/lib/captain/team-scope';
import { computePageRange, parsePage } from '@/lib/pagination';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pending Approvals — Beakn admin',
};

interface PageProps {
  params: Promise<{ captainId: string }>;
  searchParams: Promise<{ q?: string; exec?: string; page?: string }>;
}

export default async function AdminPortalApprovalsPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = await params;
  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const execFilterParam = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const page = parsePage(sp.page);

  // Captain's team — drives the exec-filter dropdown.
  const teamRows = await db
    .select({ userId: salesExecutives.userId, fullName: users.fullName })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));
  const teamExecSet = new Set(teamRows.map((t) => t.userId));
  const execFilter =
    execFilterParam && teamExecSet.has(execFilterParam)
      ? execFilterParam
      : undefined;

  const captainScope = buildCaptainRequestVisibilityWhere(captainId);

  const [pendingStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
    .limit(1);

  if (!pendingStage) {
    return (
      <div className="p-4 sm:p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Pending Approvals</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Status stages aren&apos;t seeded.
        </p>
      </div>
    );
  }

  const execUser = alias(users, 'exec_user');
  const filterPredicates = and(
    eq(visitRequests.statusStageId, pendingStage.id),
    isNull(visitRequests.cancelledAt),
    captainScope,
    search.length > 0
      ? ilike(visitRequests.customerName, `%${search}%`)
      : undefined,
    execFilter ? eq(visitRequests.assignedExecUserId, execFilter) : undefined,
  );

  const baseRows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      assignedExecName: execUser.fullName,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .where(filterPredicates);

  const rows = await Promise.all(
    baseRows.map(async (r) => {
      const [latest] = await db
        .select({
          reason: requestStatusHistory.reason,
          changedAt: requestStatusHistory.changedAt,
        })
        .from(requestStatusHistory)
        .where(
          and(
            eq(requestStatusHistory.requestId, r.id),
            eq(requestStatusHistory.toStatusStageId, pendingStage.id),
          ),
        )
        .orderBy(desc(requestStatusHistory.transitionOrder))
        .limit(1);
      return {
        ...r,
        execNote: latest?.reason ?? null,
        completedAt: latest?.changedAt ?? null,
      };
    }),
  );

  rows.sort((a, b) => {
    const aTime = a.completedAt?.getTime() ?? 0;
    const bTime = b.completedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  const totalCount = rows.length;
  const pageRange = computePageRange({ total: totalCount, page });
  const pageRows = rows.slice(
    pageRange.offset,
    pageRange.offset + pageRange.pageSize,
  );

  const basePath = `/admin/portal/${captainId}/approvals`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pending Approvals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount === 0
              ? search.length > 0 || execFilter
                ? 'No approvals match the current filter.'
                : 'No requests pending captain approval right now.'
              : `${totalCount} request${totalCount === 1 ? '' : 's'} waiting for captain.`}
          </p>
        </div>
        <Badge variant={totalCount > 0 ? 'default' : 'secondary'}>
          {totalCount} pending
        </Badge>
      </header>

      <ViewOnlyNotice message="Approve / reject actions are captain-only. Admin can review the queue here." />

      <form
        method="GET"
        action={basePath}
        className="rounded-2xl border bg-card p-3 grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Search customer
          </span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Customer name…"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Filter by exec
          </span>
          <select
            name="exec"
            defaultValue={execFilter ?? 'all'}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All execs on team</option>
            {teamRows.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.fullName}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Apply
          </button>
          <Link
            href={basePath}
            className="h-10 px-4 rounded-md border text-sm font-medium hover:bg-accent inline-flex items-center"
          >
            Reset
          </Link>
        </div>
      </form>

      {totalCount === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <Icon
            name="check_circle"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground mt-3">
            {search.length > 0 || execFilter
              ? 'Try clearing the search or picking a different exec.'
              : 'No approvals waiting.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card overflow-hidden">
          {pageRows.map((r) => (
            <li key={r.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <Link
                  href={`/requests/${r.id}`}
                  className="text-sm font-semibold tracking-tight hover:underline truncate"
                >
                  {r.customerName}
                </Link>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {r.completedAt
                    ? formatDistanceToNow(r.completedAt, { addSuffix: true })
                    : '—'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {r.cityName} · {r.assignedExecName ?? 'Unassigned'} ·{' '}
                {r.customerPhone}
              </p>
              {r.execNote && (
                <p className="text-xs text-foreground/80 italic bg-muted/40 rounded px-2 py-1">
                  &ldquo;{r.execNote}&rdquo;
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {pageRange.totalPages > 1 && (
        <Pagination
          pathname={basePath}
          page={page}
          totalPages={pageRange.totalPages}
          from={pageRange.offset + 1}
          to={Math.min(pageRange.offset + pageRange.pageSize, totalCount)}
          total={totalCount}
        />
      )}
    </div>
  );
}
