import type { Metadata } from 'next';

import {
  loadPendingApprovals,
  loadPendingCollections,
  loadTeamExecStatuses,
  loadTeamPerformance,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { loadMetrics } from '@/lib/metrics/registry';
import type { DateRange } from '@/lib/metrics/types';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadMonthlyTargetPaise,
} from '@/lib/exec/target-progress';
import { financialYearLabel, financialYearToDate } from '@/lib/date';
import { getIstDateString } from '@/lib/today/time';

import { DashboardTabNav } from '@/components/dashboard/DashboardTabNav';
import { DashboardHeader } from '@/app/(captain)/captain/dashboard/_components/DashboardHeader';
import { ExecStatusList } from '@/app/(captain)/captain/dashboard/_components/ExecStatusList';
import {
  CAPTAIN_OVERALL_METRIC_KEYS,
  OverallView,
} from '@/app/(captain)/captain/dashboard/_components/OverallView';
import { PendingApprovalsCard } from '@/app/(captain)/captain/dashboard/_components/PendingApprovalsCard';
import { PendingCollectionsCard } from '@/app/(captain)/captain/dashboard/_components/PendingCollectionsCard';
import { PerformanceCard } from '@/app/(captain)/captain/dashboard/_components/PerformanceCard';

// =============================================================================
// /admin/portal/[captainId]/dashboard — EXACT captain dashboard replica
// =============================================================================
//
// Sandeep 2026-06-14: the admin city tile must open the FULL captain
// portal, not a shrunk panel. This page renders the same Today | Overall
// tabbed dashboard the captain sees on /captain/dashboard, scoped to the
// URL-supplied captainId, reusing the captain's own components + loaders
// so the two can't drift. The parent layout already validated that the
// session is a super_admin and that captainId is a real captain.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Captain portal — Beakn admin',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_BACK = 400;

const PORTAL_TABS = [
  { value: 'today', label: 'Today' },
  { value: 'overall', label: 'Overall' },
];

function isoOffset(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function clampDateParam(s: unknown, istToday: string): string | null {
  if (typeof s !== 'string' || !DATE_PATTERN.test(s)) return null;
  const min = isoOffset(istToday, -MAX_DAYS_BACK);
  if (s > istToday) return istToday;
  if (s < min) return min;
  return s;
}

function parseDateFilter(
  params: { date?: string; from?: string; to?: string },
  istToday: string,
): DateFilter {
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
  params: Promise<{ captainId: string }>;
  searchParams: Promise<{
    date?: string;
    from?: string;
    to?: string;
    view?: string;
  }>;
}

export default async function AdminCaptainPortalDashboard({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = await params;
  const raw = await searchParams;
  const istToday = getIstDateString();
  const basePath = `/admin/portal/${captainId}`;
  const dashPath = `${basePath}/dashboard`;
  const view = raw.view === 'overall' ? 'overall' : 'today';
  const tabNav = (
    <div className="flex justify-center">
      <DashboardTabNav
        tabs={PORTAL_TABS}
        active={view}
        preserveParams={['from', 'to', 'date']}
      />
    </div>
  );

  // ---- Overall tab: FY team picture + per-exec target finish line ----
  if (view === 'overall') {
    const from = clampDateParam(raw.from, istToday);
    const to = clampDateParam(raw.to, istToday);
    let overallFilter: DateFilter;
    let overallRange: DateRange;
    if (from && to) {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      overallFilter = { mode: 'range', from: lo, to: hi };
      overallRange = { fromDate: lo, toDate: hi };
    } else {
      const fy = financialYearToDate(istToday);
      overallFilter = { mode: 'range', from: fy.fromDate, to: fy.toDate };
      overallRange = fy;
    }
    const isTodayRange =
      overallRange.fromDate === istToday && overallRange.toDate === istToday;
    const rangeLabel =
      from && to
        ? `${overallRange.fromDate} → ${overallRange.toDate}`
        : `${financialYearLabel(istToday)} · to date`;
    const monthWindow = getCurrentMonthWindow();

    const [overallValues, execProgress] = await Promise.all([
      loadMetrics(
        CAPTAIN_OVERALL_METRIC_KEYS,
        { captainUserId: captainId },
        overallRange,
      ),
      loadMonthlyTargetPaise().then((target) =>
        loadAllExecTargetProgress(monthWindow, target, {
          captainUserId: captainId,
        }),
      ),
    ]);

    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
        {tabNav}
        <OverallView
          filter={overallFilter}
          rangeLabel={rangeLabel}
          isTodayRange={isTodayRange}
          values={overallValues}
          execProgress={execProgress}
          monthLabel={monthWindow.monthLabel}
          pathname={dashPath}
        />
      </div>
    );
  }

  // ---- Today tab: the operational team view ----
  const filter = parseDateFilter(raw, istToday);

  const [performance, approvals, collections, execs] = await Promise.all([
    loadTeamPerformance(captainId, filter),
    loadPendingApprovals(captainId, filter),
    loadPendingCollections(captainId, filter),
    loadTeamExecStatuses(captainId, filter),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      {tabNav}
      <DashboardHeader filter={filter} pathname={dashPath} maxDaysBack={365} />

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
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

        <div className="md:col-span-3">
          <ExecStatusList execs={execs} filter={filter} />
        </div>
      </div>
    </div>
  );
}
