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
  loadExecDayClose,
  loadExecDayPlan,
  loadExecLeadsBreakdown,
  loadExecWeeklyReport,
} from '@/lib/captain/exec-drill-queries';
import { loadSingleExecMetrics } from '@/lib/captain/team-queries';
import { getIstDateString } from '@/lib/today/time';

// HVA-169: WeeklyReportCard + LeadsEnrolledCard moved to components/dashboard/
// so app/(exec)/dashboard can reuse them. Props + behaviour unchanged.
import { LeadsEnrolledCard } from '@/components/dashboard/LeadsEnrolledCard';
import { WeeklyReportCard } from '@/components/dashboard/WeeklyReportCard';

import { AIDailyReportCard } from './_components/AIDailyReportCard';
import { DayCloseReportSection } from './_components/DayCloseReportSection';
import { DayPlanSection } from './_components/DayPlanSection';
import { ExecDrillDownHeader } from './_components/ExecDrillDownHeader';
import { UnavailabilityScheduleSection } from './_components/UnavailabilityScheduleSection';

// =============================================================================
// HVA-167: /captain/team/[execId] — exec drill-down
// =============================================================================
//
// Sticky header + calendar + day plan (read-only) + day-closure
// (single-day traffic lights / range aggregates) + weekly report (always
// last 7 vs prev 7) + leads breakdown + AI placeholder.
//
// Auth: captain owning the exec OR super_admin. Off-team captain →
// 404 (don't leak existence per HVA-167 D12).
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ execId: string }>;
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
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

  // D12 — auth gate. 404 not 403 so cross-captain probing reveals
  // nothing about which exec ids exist.
  const allowed = await canCaptainViewExec(actor.id, execId, isAdmin);
  if (!allowed) notFound();

  const sp = await searchParams;
  const dateFilter = parseDateFilter(sp);

  // Identity row: name, captain link, phone (for the sticky-header tel: link).
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

  const captainForCities = isAdmin
    ? identityRow.captainUserId
    : actor.id;

  // Single-day filter is required by `loadTeamExecStatuses` to compute
  // today-anchored visits + collections (always TODAY in the sticky
  // header per D11). The DRY here is that the sticky header is constant;
  // the calendar selection only drives the page body.
  const todayFilter: DateFilter = {
    mode: 'single',
    date: getIstDateString(),
  };

  const [
    statuses,
    singleMetrics,
    captainCities,
    dayPlanData,
    dayCloseData,
    weeklyData,
    leadsBreakdown,
    unavailabilitySchedules,
  ] = await Promise.all([
    loadTeamExecStatuses(captainForCities, todayFilter),
    loadSingleExecMetrics(execId, todayFilter),
    loadCaptainCities(captainForCities),
    loadExecDayPlan(execId, dateFilter),
    loadExecDayClose(execId, dateFilter),
    loadExecWeeklyReport(execId),
    loadExecLeadsBreakdown(execId),
    loadExecUnavailabilitySchedules(execId),
  ]);

  const status = statuses.find((s) => s.userId === execId);
  // status may be absent if super_admin is viewing an exec on a captain
  // team that wasn't loaded — fall back gracefully.
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
          // HVA-85: drives the rebalance dialog's team-pool query. For
          // super_admin viewing the captain shell, we still need this id
          // — fall back to the request's own captain link from the
          // identity row (defined on the exec record).
          captainUserId: identityRow.captainUserId,
        }}
        cities={captainCities}
        quickStats={quickStats}
      />

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Calendar selection drives the Day Plan + Day Closure sections.
            Weekly Report is always the last 7 days.
          </p>
          <DateRangePicker
            filter={dateFilter}
            pathname={`/captain/team/${execId}`}
          />
        </div>

        <DayPlanSection data={dayPlanData} />
        <DayCloseReportSection data={dayCloseData} />
        <WeeklyReportCard data={weeklyData} />
        <LeadsEnrolledCard data={leadsBreakdown} />
        <UnavailabilityScheduleSection
          execUserId={execId}
          execName={identityRow.fullName}
          schedules={unavailabilitySchedules.map((s) => ({
            id: s.id,
            startDate: s.startDate,
            endDate: s.endDate,
            reason: s.reason,
          }))}
        />
        <AIDailyReportCard />
      </div>
    </main>
  );
}
