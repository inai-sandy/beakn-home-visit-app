import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadPendingApprovals,
  loadPendingCollections,
  loadTeamExecStatuses,
  loadTeamPerformance,
} from '@/lib/captain/dashboard-queries';

import { ExecStatusList } from './_components/ExecStatusList';
import { PendingApprovalsCard } from './_components/PendingApprovalsCard';
import { PendingCollectionsCard } from './_components/PendingCollectionsCard';
import { PerformanceCard } from './_components/PerformanceCard';

// =============================================================================
// HVA-80: Captain Dashboard — two-column desktop / stacked mobile
// =============================================================================
//
// Server component. Parallel-fetches the four data groups
// (performance / pending approvals / pending collections / team status)
// via Promise.all. No loading state needed at this scope — each query
// is a single DB round-trip and they run concurrently.
//
// Layout:
//   md+ → left column 40% (3 aggregate cards stacked), right 60% (exec list)
//   <md → single column, aggregate cards first, exec list second
//
// TODO: HVA-55 SSE will replace manual refresh with live status updates.
// Currently the dashboard reflects DB state at request time; cross-actor
// updates require the captain to refresh the page.
//
// proxy.ts gates /captain/* to role=captain + super_admin escape hatch;
// the layout in (captain) also runs the gate. The page-level role check
// below is belt-and-braces.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Beakn',
};

export default async function CaptainDashboardPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/dashboard');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const [performance, approvals, collections, execs] = await Promise.all([
    loadTeamPerformance(user.id),
    loadPendingApprovals(user.id),
    loadPendingCollections(user.id),
    loadTeamExecStatuses(user.id),
  ]);

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Today&apos;s team performance and what needs your attention.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* Left column — 2/5 of desktop width (= 40%) */}
        <div className="md:col-span-2 space-y-5">
          <PerformanceCard performance={performance} />
          <PendingApprovalsCard
            totalCount={approvals.totalCount}
            topFive={approvals.topFive}
          />
          <PendingCollectionsCard summary={collections} />
        </div>

        {/* Right column — 3/5 of desktop width (= 60%) */}
        <div className="md:col-span-3">
          <ExecStatusList execs={execs} />
        </div>
      </div>
    </div>
  );
}
