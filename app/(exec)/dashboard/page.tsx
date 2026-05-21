import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DateRangePicker } from '@/app/(captain)/captain/dashboard/_components/DateRangePicker';
import { PerformanceCard } from '@/app/(captain)/captain/dashboard/_components/PerformanceCard';
import { DayCloseMetricTiles } from '@/components/today/DayCloseMetricTiles';
import { LeadsEnrolledCard } from '@/components/dashboard/LeadsEnrolledCard';
import { WeeklyReportCard } from '@/components/dashboard/WeeklyReportCard';
import { db } from '@/db/client';
import {
  dayPlans,
  leads,
  outcomeOptions,
  postponeReasons as postponeReasonsTable,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import type { DateFilter } from '@/lib/captain/dashboard-queries';
import {
  loadExecLeadsBreakdown,
  loadExecWeeklyReport,
} from '@/lib/captain/exec-drill-queries';
import {
  loadExecCompletedTasksToday,
  loadExecDashboardSummary,
  loadExecPendingTasks,
  loadExecPerformance,
  loadExecPostponedTasksToday,
} from '@/lib/exec/dashboard-queries';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import { loadDayCloseMetrics } from '@/lib/today/metrics';
import { getIstDateString } from '@/lib/today/time';

import { ExecDashboardHeader } from './_components/ExecDashboardHeader';
import { HeroMetrics } from './_components/HeroMetrics';
import { StatusBanner } from './_components/StatusBanner';
import { TasksAccordion } from './_components/TasksAccordion';

// =============================================================================
// HVA-169: /dashboard — exec analytical surface
// =============================================================================
//
// Single-column mobile-first composition. From top to bottom:
//
//   1. ExecDashboardHeader      — title + label (always today/calendar-aware)
//   2. StatusBanner             — D2 state machine off (today's plan, time)
//   3. HeroMetrics              — 3 large numbers (today's revenue/visits/done)
//   4. TasksAccordion           — Pending / Postponed / Completed (today, +rollovers)
//   5. DateRangePicker          — scopes (6) + (7)
//   6. DayCloseMetricTiles      — 6-tile target grid (scoped by calendar)
//   7. WeeklyReportCard         — fixed last-7-vs-prev-7
//   8. PerformanceCard          — scoped by calendar
//   9. LeadsEnrolledCard        — lifetime
//
// /today stays as the operational loop. Login redirect (HVA-169 D1) sends
// execs to /today if no plan today, else /dashboard.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Beakn',
  description: 'Your day at a glance.',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidIstDateString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!DATE_PATTERN.test(s)) return false;
  const istToday = getIstDateString();
  if (s > istToday) return false;
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

function groupOutcomeOptions(
  rows: Array<{ id: string; taskType: string; code: string; name: string }>,
): Record<string, Array<{ id: string; code: string; name: string }>> {
  const out: Record<string, Array<{ id: string; code: string; name: string }>> = {};
  for (const r of rows) {
    if (!out[r.taskType]) out[r.taskType] = [];
    out[r.taskType].push({ id: r.id, code: r.code, name: r.name });
  }
  return out;
}

export default async function ExecDashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/dashboard');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const raw = await searchParams;
  const filter = parseDateFilter(raw);
  const istDate = getIstDateString();

  // The DayCloseMetricTiles need a real day_plan to scope against. When
  // the exec has not submitted today's plan we render an EMPTY metrics
  // surface (zero counts) — handled inline below.
  const [todayPlan] = await db
    .select({ id: dayPlans.id, submittedAt: dayPlans.submittedAt })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istDate)))
    .limit(1);

  const [
    summary,
    pending,
    postponed,
    completed,
    dayCloseMetrics,
    weekly,
    performance,
    leadsBreakdown,
    allOutcomeOptions,
    allPostponeReasons,
  ] = await Promise.all([
    loadExecDashboardSummary(user.id),
    loadExecPendingTasks(user.id),
    loadExecPostponedTasksToday(user.id),
    loadExecCompletedTasksToday(user.id),
    todayPlan
      ? loadDayCloseMetrics({
          execUserId: user.id,
          dayPlanId: todayPlan.id,
          dayPlanSubmittedAt: todayPlan.submittedAt,
          istDateStr: istDate,
        })
      : Promise.resolve(emptyDayCloseMetrics()),
    loadExecWeeklyReport(user.id),
    loadExecPerformance(user.id, filter),
    loadExecLeadsBreakdown(user.id),
    db
      .select({
        id: outcomeOptions.id,
        taskType: outcomeOptions.taskType,
        code: outcomeOptions.code,
        name: outcomeOptions.name,
        sequenceNumber: outcomeOptions.sequenceNumber,
      })
      .from(outcomeOptions)
      .where(eq(outcomeOptions.isActive, true))
      .orderBy(asc(outcomeOptions.taskType), asc(outcomeOptions.sequenceNumber)),
    db
      .select({
        id: postponeReasonsTable.id,
        code: postponeReasonsTable.code,
        name: postponeReasonsTable.name,
      })
      .from(postponeReasonsTable)
      .where(eq(postponeReasonsTable.isActive, true))
      .orderBy(asc(postponeReasonsTable.sequenceNumber)),
  ]);

  // Linkable pools for TaskItem's Edit sheet (mirrors /today/page.tsx).
  const visibleContactIds = await loadExecVisibleContactIds(user.id);
  const [linkableRequests, linkableLeads] = await Promise.all([
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
      })
      .from(visitRequests)
      .where(eq(visitRequests.assignedExecUserId, user.id))
      .orderBy(asc(visitRequests.createdAt))
      .limit(50),
    visibleContactIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string; phone: string }>)
      : db
          .select({ id: leads.id, name: leads.name, phone: leads.phone })
          .from(leads)
          .where(
            and(
              inArray(leads.id, visibleContactIds),
              isNull(leads.convertedToRequestId),
            ),
          )
          .orderBy(asc(leads.createdAt))
          .limit(50),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
      <ExecDashboardHeader filter={filter} />
      <StatusBanner state={summary.banner} />
      <HeroMetrics metrics={dayCloseMetrics} />
      <TasksAccordion
        pending={pending}
        postponed={postponed}
        completed={completed}
        outcomeOptionsByType={groupOutcomeOptions(allOutcomeOptions)}
        postponeReasons={allPostponeReasons}
        linkableRequests={linkableRequests}
        linkableLeads={linkableLeads}
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Calendar scopes Performance + Day Closure. Weekly Report is always
          last 7 vs previous 7.
        </p>
        <DateRangePicker filter={filter} pathname="/dashboard" />
      </div>
      <section aria-label="Today's day closure" className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Day Closure</h2>
        <DayCloseMetricTiles
          metrics={dayCloseMetrics}
          mode={filter.mode === 'range' ? 'range' : 'single'}
        />
      </section>
      <WeeklyReportCard data={weekly} />
      <PerformanceCard performance={performance} />
      <LeadsEnrolledCard data={leadsBreakdown} />
    </main>
  );
}

// Empty/zero DayCloseMetrics shape used when there's no day plan today.
// Mirrors EMPTY_METRICS in lib/captain/exec-drill-queries.ts — keeping a
// local copy so the dashboard doesn't import private internals.
function emptyDayCloseMetrics() {
  const noTarget = { actual: 0, target: null, status: 'no_target' as const };
  return {
    taskCounts: {
      done: 0,
      postponed: 0,
      pending: 0,
      totalAtSubmission: 0,
      addedDuringDay: 0,
      fastCompletionCount: 0,
    },
    amountCollectedPaise: 0,
    inboundPaymentCount: 0,
    quotationsCount: 0,
    targets: {
      revenue: { ...noTarget },
      visits: { ...noTarget },
      quotations: { ...noTarget },
      orders: { ...noTarget },
      conversionPct: { actual: null, target: null, status: 'no_target' as const },
      taskCompletionPct: { actual: null, target: null, status: 'no_target' as const },
    },
  };
}
