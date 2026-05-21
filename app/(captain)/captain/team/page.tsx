import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  loadTeamExecStatuses,
  offsetIstDate,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { loadTeamExecMetrics } from '@/lib/captain/team-queries';
import { getIstDateString } from '@/lib/today/time';

import { EmptyTeamState } from './_components/EmptyTeamState';
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
  searchParams: Promise<{ window?: string }>;
}

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
        eq(salesExecutives.captainUserId, user.id),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));

  if (teamRoster.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">My Team</h1>
        </header>
        <TeamWindowToggle active={window} />
        <EmptyTeamState />
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
          .
        </p>
      </header>

      <TeamWindowToggle active={window} />

      <ul className="space-y-2" aria-label="Team members">
        {members.map((m) => (
          <li key={m.userId}>
            <TeamMemberCard member={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}
