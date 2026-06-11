import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadPendingApprovals,
  loadPendingCollections,
  loadTeamExecStatuses,
  loadTeamPerformance,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { DashboardHeader } from './_components/DashboardHeader';
import { ExecStatusList } from './_components/ExecStatusList';
import { PendingApprovalsCard } from './_components/PendingApprovalsCard';
import { PendingCollectionsCard } from './_components/PendingCollectionsCard';
import { PerformanceCard } from './_components/PerformanceCard';
import { FadeRise } from '@/components/motion/motion-kit';

// =============================================================================
// HVA-80: Captain Dashboard — two-column desktop / stacked mobile
// =============================================================================
//
// Extended (PR after #83) with date filtering via search params:
//   /captain/dashboard                       → today (single-date)
//   /captain/dashboard?date=YYYY-MM-DD       → that single past date
//   /captain/dashboard?from=YYYY-MM-DD
//                     &to=YYYY-MM-DD         → date range, both inclusive
//
// Constraints applied at the parser level (also enforced by the UI's
// calendar modal min/max attrs):
//   - dates must be ≤ today
//   - dates must be ≥ 30 days before today
//   - bad/malformed params silently fall back to today
//
// TODO: HVA-55 SSE will replace manual refresh with live status updates.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Beakn',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIstDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!DATE_PATTERN.test(s)) return false;
  const istToday = getIstDateString();
  // Reject future dates (max = today IST) and dates older than 30 days.
  if (s > istToday) return false;
  // Use string lex compare since YYYY-MM-DD sorts lexically.
  const [ty, tm, td] = istToday.split('-').map(Number);
  const minDate = new Date(Date.UTC(ty, tm - 1, td - 30));
  const minStr = `${minDate.getUTCFullYear()}-${String(minDate.getUTCMonth() + 1).padStart(2, '0')}-${String(minDate.getUTCDate()).padStart(2, '0')}`;
  if (s < minStr) return false;
  return true;
}

function parseDateFilter(params: {
  date?: string;
  from?: string;
  to?: string;
}): DateFilter {
  // Range mode wins if BOTH `from` and `to` are present and valid AND
  // from <= to. Otherwise we try single-date `date`. Otherwise today.
  if (params.from && params.to) {
    if (
      isValidIstDateString(params.from) &&
      isValidIstDateString(params.to) &&
      params.from <= params.to
    ) {
      return { mode: 'range', from: params.from, to: params.to };
    }
  }
  if (params.date && isValidIstDateString(params.date)) {
    return { mode: 'single', date: params.date };
  }
  return { mode: 'single', date: getIstDateString() };
}

interface PageProps {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}

export default async function CaptainDashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/dashboard');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const raw = await searchParams;
  const filter = parseDateFilter(raw);

  const [
    performance,
    approvals,
    collections,
    execs,
  ] = await Promise.all([
    loadTeamPerformance(user.id, filter),
    loadPendingApprovals(user.id, filter),
    loadPendingCollections(user.id, filter),
    loadTeamExecStatuses(user.id, filter),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <DashboardHeader filter={filter} />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* Left column — 2/5 of desktop width (= 40%) */}
        <div className="md:col-span-2 space-y-5">
          {/* HVA-269: cards rise in with a gentle stagger. The cards
              themselves stay server-rendered — FadeRise is a thin
              client wrapper around RSC children. */}
          <FadeRise>
            <PerformanceCard performance={performance} />
          </FadeRise>
          <FadeRise delay={0.06}>
            <PendingApprovalsCard
              totalCount={approvals.totalCount}
              staleCount={approvals.staleCount}
              topFive={approvals.topFive}
              filter={filter}
            />
          </FadeRise>
          <FadeRise delay={0.12}>
            <PendingCollectionsCard summary={collections} filter={filter} />
          </FadeRise>
        </div>

        {/* Right column — 3/5 of desktop width (= 60%) */}
        <div className="md:col-span-3">
          <FadeRise delay={0.18}>
            <ExecStatusList execs={execs} filter={filter} />
          </FadeRise>
        </div>
      </div>
    </div>
  );
}
