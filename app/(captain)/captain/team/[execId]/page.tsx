import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { DateRangePicker } from '@/app/(captain)/captain/dashboard/_components/DateRangePicker';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadExecUnavailabilitySchedules } from '@/lib/captain/availability';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  loadTeamExecStatuses,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import {
  canCaptainViewExec,
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

import { AIDailyReportCard } from './_components/AIDailyReportCard';
import { AuditTrailTab } from './_components/AuditTrailTab';
import { DayCloseReportSection } from './_components/DayCloseReportSection';
import { DayPlanSection } from './_components/DayPlanSection';
import { ExecDrillDownHeader } from './_components/ExecDrillDownHeader';
import {
  ExecDrillTabsNav,
  isValidExecDrillTab,
  type ExecDrillTab,
} from './_components/ExecDrillTabsNav';
import { OpenRequestsTab } from './_components/OpenRequestsTab';
import { PendingCollectionsTab } from './_components/PendingCollectionsTab';
import { RedFlagsTab } from './_components/RedFlagsTab';
import { UnavailabilityScheduleSection } from './_components/UnavailabilityScheduleSection';

// =============================================================================
// HVA-83: /captain/team/[execId] — 7-tab drill-down
// =============================================================================
//
// Tabs: Today's Plan | Calendar | Performance | Open Requests |
//       Pending Collections | Red Flags | Audit Trail.
//
// URL-driven, server-rendered. ?tab=... selects the active tab; other
// query params (date / from / to / page) are preserved across tab
// switches by the ExecDrillTabsNav helper.
//
// Auth gate: canCaptainViewExec(captainUserId, execId, isAdmin). Off-team
// captain → 404 (D12 — don't leak existence).
// =============================================================================

const AUDIT_PAGE_SIZE = 25;

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ execId: string }>;
  searchParams: Promise<{
    tab?: string;
    date?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { execId } = await params;
  return {
    title: 'Exec drill-down — Captain',
    description: `Exec ${execId.slice(0, 8)}`,
  };
}

function isValidIstDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

export default async function CaptainTeamExecDrillDownPage({
  params,
  searchParams,
}: PageProps) {
  const { execId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/login?next=/captain/team/${execId}`);

  const actor = session.user as { id: string; role?: string };
  if (actor.role !== 'captain' && actor.role !== 'super_admin') {
    redirect('/login');
  }
  const isAdmin = actor.role === 'super_admin';

  const allowed = await canCaptainViewExec(actor.id, execId, isAdmin);
  if (!allowed) notFound();

  const sp = await searchParams;
  const dateFilter = parseDateFilter(sp);
  const activeTab: ExecDrillTab = isValidExecDrillTab(sp.tab)
    ? sp.tab
    : 'today';
  const preservedQuery = preservedQueryFor(sp);

  // Identity + sticky-header quick stats are always today-anchored.
  const [identityRow] = await db
    .select({
      userId: salesExecutives.userId,
      captainUserId: salesExecutives.captainUserId,
      fullName: users.fullName,
      phone: users.phone,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(eq(salesExecutives.userId, execId), eq(users.isActive, true)),
    )
    .limit(1);
  if (!identityRow) notFound();

  const captainForCities = isAdmin ? identityRow.captainUserId : actor.id;

  const todayFilter: DateFilter = {
    mode: 'single',
    date: getIstDateString(),
  };

  const [statuses, singleMetrics, captainCities] = await Promise.all([
    loadTeamExecStatuses(captainForCities, todayFilter),
    loadSingleExecMetrics(execId, todayFilter),
    loadCaptainCities(captainForCities),
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
      />

      <ExecDrillTabsNav
        execId={execId}
        activeTab={activeTab}
        preservedQuery={preservedQuery}
      />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 space-y-4">
        {(activeTab === 'today' || activeTab === 'calendar') && (
          <div className="flex justify-end">
            <DateRangePicker
              filter={dateFilter}
              pathname={`/captain/team/${execId}`}
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
        {activeTab === 'requests' && (
          <RequestsTabContent execId={execId} />
        )}
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

// Per-tab loaders keep the page top-level clean. Each is a server component
// that fetches what its tab needs + renders the section components.

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
  // v1: reuse DayPlanSection in range mode. Real Day/Week/Month switcher
  // is a follow-up (HVA-83-FOLLOWUP).
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

