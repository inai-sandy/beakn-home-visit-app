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
//   - dates must be ≤ today and ≥ 365 days before today (HVA-278)
//   - out-of-range params CLAMP to the nearest allowed date;
//     unparseable params fall back to today
//
// TODO: HVA-55 SSE will replace manual refresh with live status updates.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Beakn',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// HVA-278: 30 → 365. The 30-day wall + silent reset-to-today was the
// literal "I picked 31 days and it landed in today" complaint.
const MAX_DAYS_BACK = 365;

function isoOffset(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Clamp an incoming date param into [today − 365, today]. Returns null
 *  only for unparseable input. Clamping (not resetting) keeps the
 *  user's intent — "too far back" lands on the oldest allowed day,
 *  never silently on today. */
function clampDateParam(s: unknown, istToday: string): string | null {
  if (typeof s !== 'string' || !DATE_PATTERN.test(s)) return null;
  const min = isoOffset(istToday, -MAX_DAYS_BACK);
  if (s > istToday) return istToday;
  if (s < min) return min;
  return s;
}

function parseDateFilter(params: {
  date?: string;
  from?: string;
  to?: string;
}): DateFilter {
  const istToday = getIstDateString();
  const from = clampDateParam(params.from, istToday);
  const to = clampDateParam(params.to, istToday);
  if (from && to) {
    return from <= to
      ? { mode: 'range', from, to }
      : { mode: 'range', from: to, to: from };
  }
  const single = clampDateParam(params.date, istToday);
  return { mode: 'single', date: single ?? istToday };
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
      <DashboardHeader filter={filter} maxDaysBack={365} />

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
