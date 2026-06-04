import { and, asc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/lists/Pagination';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  loadTeamExecStatuses,
  offsetIstDate,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { loadTeamExecMetrics } from '@/lib/captain/team-queries';
import { computePageRange, parsePage } from '@/lib/pagination';
import { getIstDateString } from '@/lib/today/time';

import { EmptyTeamState } from './_components/EmptyTeamState';
import { TeamSearchInput } from './_components/TeamSearchInput';
import {
  TeamWindowToggle,
  type TeamWindow,
} from './_components/TeamWindowToggle';
import {
  TeamMemberCard,
  type TeamMember,
} from './_components/TeamMemberCard';

// =============================================================================
// HVA-154: /captain/team — list every active exec on the captain's team,
// with a date-window toggle that drives the "contacts captured" count.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Team — Captain',
};

interface PageProps {
  searchParams: Promise<{ window?: string; q?: string; page?: string }>;
}

const PAGE_SIZE = 50;

function parseWindow(raw: unknown): TeamWindow {
  if (raw === 'today' || raw === 'week' || raw === 'month') return raw;
  return 'week';
}

function buildDateFilter(window: TeamWindow): DateFilter {
  const today = getIstDateString();
  if (window === 'today') {
    return { mode: 'single', date: today };
  }
  if (window === 'week') {
    return { mode: 'range', from: offsetIstDate(today, -6), to: today };
  }
  // 'month' — last 30 days inclusive of today
  return { mode: 'range', from: offsetIstDate(today, -29), to: today };
}

export default async function CaptainTeamPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/team');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const params = await searchParams;
  const window = parseWindow(params.window);
  const search = (params.q ?? '').trim();
  const page = parsePage(params.page);
  const dateFilter = buildDateFilter(window);

  // super_admin has no team to list — show the empty state. They can use
  // the dashboard for cross-team visibility.
  if (user.role === 'super_admin') {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">My Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Super-admin has no team scope.
          </p>
        </header>
        <TeamWindowToggle active={window} />
        <EmptyTeamState />
      </div>
    );
  }

  // Captain's team — pull phone alongside id/name in one round trip, so
  // we don't have to ask loadTeamExecStatuses to re-shape its output.
  // Same active-team filter the dashboard's loadTeamExecStatuses uses.
  // 2026-05-26: optional name/phone search via `?q=`. ILIKE on
  // users.full_name + users.phone (digit substring), AND'd with the
  // active-team scope. Empty/whitespace search is a no-op.
  const searchTerm = search.toLowerCase();
  const searchPredicate =
    searchTerm.length > 0
      ? sql`(LOWER(${users.fullName}) LIKE ${`%${searchTerm}%`}
            OR LOWER(${users.phone}) LIKE ${`%${searchTerm}%`})`
      : undefined;

  const whereClause = and(
    eq(salesExecutives.captainUserId, user.id),
    eq(users.isActive, true),
    searchPredicate,
  );

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(whereClause);

  const range = computePageRange({ total, page, pageSize: PAGE_SIZE });

  const teamRoster = await db
    .select({
      userId: salesExecutives.userId,
      fullName: users.fullName,
      phone: users.phone,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(whereClause)
    .orderBy(asc(users.fullName))
    .limit(range.pageSize)
    .offset(range.offset);

  if (teamRoster.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">My Team</h1>
        </header>
        <TeamSearchInput initial={search} />
        <TeamWindowToggle active={window} />
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
    loadTeamExecStatuses(user.id, dateFilter),
    loadTeamExecMetrics(user.id, dateFilter),
  ]);

  // Merge the three sources into a single TeamMember[]. Roster is the
  // authoritative roster (joined to users for phone); statuses + metrics
  // are looked up by userId — execs missing from either default to safe
  // zeros / `hasRedFlag = false` so the page can't crash on a stale
  // partial response.
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
          {members.length} active {members.length === 1 ? 'executive' : 'executives'}
          {search.length > 0 ? ` matching “${search}”` : ''}.
        </p>
      </header>

      <TeamSearchInput initial={search} />
      <TeamWindowToggle active={window} />

      <ul className="space-y-2" aria-label="Team members">
        {members.map((m) => (
          <li key={m.userId}>
            <TeamMemberCard member={m} />
          </li>
        ))}
      </ul>

      {range.totalPages > 1 && (
        <Pagination
          pathname="/captain/team"
          page={page}
          totalPages={range.totalPages}
          from={range.offset + 1}
          to={Math.min(range.offset + range.pageSize, total)}
          total={total}
        />
      )}
    </div>
  );
}
