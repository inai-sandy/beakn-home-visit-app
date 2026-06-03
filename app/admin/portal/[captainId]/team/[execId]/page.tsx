import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DateRangePicker } from '@/app/(captain)/captain/dashboard/_components/DateRangePicker';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { loadExecUnavailabilitySchedules } from '@/lib/captain/availability';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  loadTeamExecStatuses,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import {
  loadExecAuditTrail,
  loadExecDayClose,
  loadExecDayPlan,
  loadExecLeadsBreakdown,
  loadExecOpenRequests,
  loadExecPendingCollections,
  loadExecWeeklyReport,
} from '@/lib/captain/exec-drill-queries';
import { loadSingleExecMetrics } from '@/lib/captain/team-queries';
import { getIstDateString } from '@/lib/today/time';

import { LeadsEnrolledCard } from '@/components/dashboard/LeadsEnrolledCard';
import { WeeklyReportCard } from '@/components/dashboard/WeeklyReportCard';

import { AIDailyReportCard } from '@/app/(captain)/captain/team/[execId]/_components/AIDailyReportCard';
import { AuditTrailTab } from '@/app/(captain)/captain/team/[execId]/_components/AuditTrailTab';
import { DayCloseReportSection } from '@/app/(captain)/captain/team/[execId]/_components/DayCloseReportSection';
import { DayPlanSection } from '@/app/(captain)/captain/team/[execId]/_components/DayPlanSection';
import { ExecDrillDownHeader } from '@/app/(captain)/captain/team/[execId]/_components/ExecDrillDownHeader';
import {
  ExecDrillTabsNav,
  isValidExecDrillTab,
  type ExecDrillTab,
} from '@/app/(captain)/captain/team/[execId]/_components/ExecDrillTabsNav';
import { OpenRequestsTab } from '@/app/(captain)/captain/team/[execId]/_components/OpenRequestsTab';
import { PendingCollectionsTab } from '@/app/(captain)/captain/team/[execId]/_components/PendingCollectionsTab';
import { RedFlagsTab } from '@/app/(captain)/captain/team/[execId]/_components/RedFlagsTab';
import { UnavailabilityScheduleSection } from '@/app/(captain)/captain/team/[execId]/_components/UnavailabilityScheduleSection';

// =============================================================================
// /admin/portal/[captainId]/team/[execId] — admin exec drill (read-only)
// =============================================================================
//
// Full mirror of /captain/team/[execId]. Auth is delegated to the
// parent /admin/portal/[captainId] layout (super_admin only); admin
// can view any exec belonging to the URL captain. We do not call
// canCaptainViewExec because admin is intentionally cross-team.
// =============================================================================

const AUDIT_PAGE_SIZE = 25;

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    tab?: string;
    date?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Exec drill-down — Beakn admin' };
}

function isValidIstDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateFilter(sp: {
  date?: string;
  from?: string;
  to?: string;
}): DateFilter {
  if (sp.from && sp.to) {
    if (
      isValidIstDateString(sp.from) &&
      isValidIstDateString(sp.to) &&
      sp.from <= sp.to
    ) {
      return { mode: 'range', from: sp.from, to: sp.to };
    }
  }
  if (sp.date && isValidIstDateString(sp.date)) {
    return { mode: 'single', date: sp.date };
  }
  return { mode: 'single', date: getIstDateString() };
}

function preservedQueryFor(sp: {
  date?: string;
  from?: string;
  to?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (sp.date) out.date = sp.date;
  if (sp.from) out.from = sp.from;
  if (sp.to) out.to = sp.to;
  return out;
}

export default async function AdminPortalExecDrillPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId, execId } = (await params) as {
    captainId: string;
    execId: string;
  };
  const sp = await searchParams;
  const dateFilter = parseDateFilter(sp);
  const activeTab: ExecDrillTab = isValidExecDrillTab(sp.tab) ? sp.tab : 'today';
  const preservedQuery = preservedQueryFor(sp);
  const basePath = `/admin/portal/${captainId}/team`;

  const [identityRow] = await db
    .select({
      userId: salesExecutives.userId,
      captainUserId: salesExecutives.captainUserId,
      fullName: users.fullName,
      phone: users.phone,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(and(eq(salesExecutives.userId, execId), eq(users.isActive, true)))
    .limit(1);
  if (!identityRow) notFound();

  // The portal scopes to a specific captain; reject if the exec
  // doesn't belong to that captain so admins can't deep-link into a
  // mismatched (captain, exec) pair.
  if (identityRow.captainUserId !== captainId) notFound();

  const todayFilter: DateFilter = {
    mode: 'single',
    date: getIstDateString(),
  };

  const [statuses, singleMetrics, captainCities] = await Promise.all([
    loadTeamExecStatuses(captainId, todayFilter),
    loadSingleExecMetrics(execId, todayFilter),
    loadCaptainCities(captainId),
  ]);

  const status = statuses.find((s) => s.userId === execId);
  const quickStats = {
    visitsToday: status?.visitsToday ?? 0,
    collectionsTodayRupees: status?.collectionsTodayRupees ?? 0,
    activeRequestCount: singleMetrics?.activeRequestCount ?? 0,
    overdueTaskCount: status?.overdueTaskCount ?? 0,
  };

  return (
    <main className="min-h-svh bg-background pb-24">
      <ExecDrillDownHeader
        exec={{
          userId: execId,
          fullName: identityRow.fullName,
          phone: identityRow.phone,
          isUnavailable: singleMetrics?.isUnavailable ?? false,
          hasRedFlag: status?.hasRedFlag ?? false,
          captainUserId: identityRow.captainUserId,
        }}
        cities={captainCities}
        quickStats={quickStats}
        backFallback={basePath}
      />

      <ExecDrillTabsNav
        execId={execId}
        activeTab={activeTab}
        preservedQuery={preservedQuery}
        basePath={basePath}
      />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 space-y-4">
        {(activeTab === 'today' || activeTab === 'calendar') && (
          <div className="flex justify-end">
            <DateRangePicker
              filter={dateFilter}
              pathname={`${basePath}/${execId}`}
            />
          </div>
        )}

        {activeTab === 'today' && (
          <TodayTabContent execId={execId} dateFilter={dateFilter} />
        )}
        {activeTab === 'calendar' && (
          <CalendarTabContent execId={execId} dateFilter={dateFilter} />
        )}
        {activeTab === 'performance' && (
          <PerformanceTabContent execId={execId} dateFilter={dateFilter} />
        )}
        {activeTab === 'requests' && <RequestsTabContent execId={execId} />}
        {activeTab === 'collections' && (
          <CollectionsTabContent execId={execId} />
        )}
        {activeTab === 'red-flags' && <RedFlagsTab />}
        {activeTab === 'audit' && (
          <AuditTabContent
            execId={execId}
            pageParam={sp.page}
            preservedQuery={preservedQuery}
          />
        )}
      </div>
    </main>
  );
}

async function TodayTabContent({
  execId,
  dateFilter,
}: {
  execId: string;
  dateFilter: DateFilter;
}) {
  const [dayPlanData, dayCloseData, unavailabilitySchedules] =
    await Promise.all([
      loadExecDayPlan(execId, dateFilter),
      loadExecDayClose(execId, dateFilter),
      loadExecUnavailabilitySchedules(execId),
    ]);
  return (
    <>
      <DayPlanSection data={dayPlanData} />
      <DayCloseReportSection data={dayCloseData} />
      <UnavailabilityScheduleSection
        execUserId={execId}
        execName=""
        schedules={unavailabilitySchedules.map((s) => ({
          id: s.id,
          startDate: s.startDate,
          endDate: s.endDate,
          reason: s.reason,
        }))}
      />
    </>
  );
}

async function CalendarTabContent({
  execId,
  dateFilter,
}: {
  execId: string;
  dateFilter: DateFilter;
}) {
  const dayPlanData = await loadExecDayPlan(execId, dateFilter);
  return <DayPlanSection data={dayPlanData} />;
}

async function PerformanceTabContent({
  execId,
  dateFilter,
}: {
  execId: string;
  dateFilter: DateFilter;
}) {
  const [dayCloseData, weeklyData, leadsBreakdown] = await Promise.all([
    loadExecDayClose(execId, dateFilter),
    loadExecWeeklyReport(execId),
    loadExecLeadsBreakdown(execId),
  ]);
  return (
    <>
      <DayCloseReportSection data={dayCloseData} />
      <WeeklyReportCard data={weeklyData} />
      <LeadsEnrolledCard data={leadsBreakdown} />
      <AIDailyReportCard />
    </>
  );
}

async function RequestsTabContent({ execId }: { execId: string }) {
  const rows = await loadExecOpenRequests(execId);
  return <OpenRequestsTab rows={rows} />;
}

async function CollectionsTabContent({ execId }: { execId: string }) {
  const rows = await loadExecPendingCollections(execId);
  return <PendingCollectionsTab rows={rows} />;
}

async function AuditTabContent({
  execId,
  pageParam,
  preservedQuery,
}: {
  execId: string;
  pageParam: string | undefined;
  preservedQuery: Record<string, string>;
}) {
  const parsed = pageParam ? Number.parseInt(pageParam, 10) : 1;
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const { rows, total } = await loadExecAuditTrail({
    execUserId: execId,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  });
  return (
    <AuditTrailTab
      rows={rows}
      page={page}
      pageSize={AUDIT_PAGE_SIZE}
      total={total}
      execId={execId}
      preservedQuery={preservedQuery}
    />
  );
}
