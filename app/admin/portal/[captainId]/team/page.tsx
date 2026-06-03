import { and, asc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';

import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import {
  loadTeamExecStatuses,
  offsetIstDate,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { loadTeamExecMetrics } from '@/lib/captain/team-queries';
import { getIstDateString } from '@/lib/today/time';

import { EmptyTeamState } from '@/app/(captain)/captain/team/_components/EmptyTeamState';
import { TeamSearchInput } from '@/app/(captain)/captain/team/_components/TeamSearchInput';
import {
  TeamWindowToggle,
  type TeamWindow,
} from '@/app/(captain)/captain/team/_components/TeamWindowToggle';
import {
  TeamMemberCard,
  type TeamMember,
} from '@/app/(captain)/captain/team/_components/TeamMemberCard';

// Full mirror of /captain/team scoped to URL captainId. Same search +
// window-toggle UX, same TeamMemberCard rows linking into the admin
// portal's exec drill at /admin/portal/[captainId]/team/[execId].

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Team — Beakn admin',
};

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{ window?: string; q?: string }>;
}

function parseWindow(raw: unknown): TeamWindow {
  if (raw === 'today' || raw === 'week' || raw === 'month') return raw;
  return 'week';
}

function buildDateFilter(window: TeamWindow): DateFilter {
  const today = getIstDateString();
  if (window === 'today') return { mode: 'single', date: today };
  if (window === 'week') {
    return { mode: 'range', from: offsetIstDate(today, -6), to: today };
  }
  return { mode: 'range', from: offsetIstDate(today, -29), to: today };
}

export default async function AdminPortalTeamPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = (await params) as { captainId: string };
  const sp = await searchParams;
  const window = parseWindow(sp.window);
  const search = (sp.q ?? '').trim();
  const dateFilter = buildDateFilter(window);
  const basePath = `/admin/portal/${captainId}/team`;

  const searchTerm = search.toLowerCase();
  const searchPredicate =
    searchTerm.length > 0
      ? sql`(LOWER(${users.fullName}) LIKE ${`%${searchTerm}%`}
            OR LOWER(${users.phone}) LIKE ${`%${searchTerm}%`})`
      : undefined;

  const teamRoster = await db
    .select({
      userId: salesExecutives.userId,
      fullName: users.fullName,
      phone: users.phone,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainId),
        eq(users.isActive, true),
        searchPredicate,
      ),
    )
    .orderBy(asc(users.fullName));

  if (teamRoster.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">My Team</h1>
        </header>
        <TeamSearchInput initial={search} basePath={basePath} />
        <TeamWindowToggle active={window} basePath={basePath} />
        {search.length > 0 ? (
          <div className="rounded-3xl border bg-muted/40 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No team members match &ldquo;{search}&rdquo;.
            </p>
          </div>
        ) : (
          <EmptyTeamState />
        )}
      </div>
    );
  }

  const [statuses, metrics] = await Promise.all([
    loadTeamExecStatuses(captainId, dateFilter),
    loadTeamExecMetrics(captainId, dateFilter),
  ]);

  const statusById = new Map(statuses.map((s) => [s.userId, s]));
  const members: TeamMember[] = teamRoster.map((r) => {
    const s = statusById.get(r.userId);
    const m = metrics.get(r.userId);
    return {
      userId: r.userId,
      fullName: r.fullName,
      phone: r.phone,
      isUnavailable: m?.isUnavailable ?? false,
      hasRedFlag: s?.hasRedFlag ?? false,
      overdueTaskCount: s?.overdueTaskCount ?? 0,
      activeRequestCount: m?.activeRequestCount ?? 0,
      contactsCapturedInWindow: m?.contactsCapturedInWindow ?? 0,
    };
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {members.length} active{' '}
          {members.length === 1 ? 'executive' : 'executives'}
          {search.length > 0 ? ` matching “${search}”` : ''}.
        </p>
      </header>

      <TeamSearchInput initial={search} />
      <TeamWindowToggle active={window} />

      <ul className="space-y-2" aria-label="Team members">
        {members.map((m) => (
          <li key={m.userId}>
            <TeamMemberCard member={m} basePath={basePath} />
          </li>
        ))}
      </ul>
    </div>
  );
}
