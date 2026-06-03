import type { Metadata } from 'next';

import {
  loadPendingApprovals,
  loadPendingCollections,
  loadTeamExecStatuses,
  loadTeamPerformance,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { DashboardHeader } from '@/app/(captain)/captain/dashboard/_components/DashboardHeader';
import { ExecStatusList } from '@/app/(captain)/captain/dashboard/_components/ExecStatusList';
import { PendingApprovalsCard } from '@/app/(captain)/captain/dashboard/_components/PendingApprovalsCard';
import { PendingCollectionsCard } from '@/app/(captain)/captain/dashboard/_components/PendingCollectionsCard';
import { PerformanceCard } from '@/app/(captain)/captain/dashboard/_components/PerformanceCard';

// =============================================================================
// /admin/portal/[captainId]/dashboard — read-only captain dashboard
// =============================================================================
//
// Sandeep 2026-06-03: the admin city tile opens the captain's portal.
// This page is the entry point — it renders the same dashboard the
// captain sees on /captain/dashboard, but routed via the URL-supplied
// captainId so super_admin can view any captain's portal without
// logging out.
//
// The captain layout (app/(captain)/layout.tsx) gates this same
// dashboard by `cities.captain_user_id`. Here we trust the URL
// captainId verbatim because the parent layout (`layout.tsx` next
// door) already validated:
//   1. session belongs to a super_admin
//   2. the captainId resolves to a user with role='captain'
//
// Date picker URL state and component contracts are identical to
// /captain/dashboard. Components accept a basePath prop that retargets
// any internal navigation back into the admin portal namespace.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Captain portal — Beakn admin',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIstDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!DATE_PATTERN.test(s)) return false;
  const istToday = getIstDateString();
  if (s > istToday) return false;
  const [ty, tm, td] = istToday.split('-').map(Number);
  const minDate = new Date(Date.UTC(ty, tm - 1, td - 30));
  const minStr = `${minDate.getUTCFullYear()}-${String(
    minDate.getUTCMonth() + 1,
  ).padStart(2, '0')}-${String(minDate.getUTCDate()).padStart(2, '0')}`;
  if (s < minStr) return false;
  return true;
}

function parseDateFilter(params: {
  date?: string;
  from?: string;
  to?: string;
}): DateFilter {
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
  params: Promise<{ captainId: string }>;
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}

export default async function AdminCaptainPortalDashboard({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = await params;
  const raw = await searchParams;
  const filter = parseDateFilter(raw);
  const basePath = `/admin/portal/${captainId}`;

  const [performance, approvals, collections, execs] = await Promise.all([
    loadTeamPerformance(captainId, filter),
    loadPendingApprovals(captainId, filter),
    loadPendingCollections(captainId, filter),
    loadTeamExecStatuses(captainId, filter),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <DashboardHeader filter={filter} pathname={`${basePath}/dashboard`} />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* Left column — 2/5 of desktop width (= 40%) */}
        <div className="md:col-span-2 space-y-5">
          <PerformanceCard performance={performance} />
          <PendingApprovalsCard
            totalCount={approvals.totalCount}
            staleCount={approvals.staleCount}
            topFive={approvals.topFive}
            filter={filter}
            basePath={basePath}
          />
          <PendingCollectionsCard
            summary={collections}
            filter={filter}
            basePath={basePath}
          />
        </div>

        {/* Right column — 3/5 of desktop width (= 60%) */}
        <div className="md:col-span-3">
          <ExecStatusList execs={execs} filter={filter} />
        </div>
      </div>
    </div>
  );
}
