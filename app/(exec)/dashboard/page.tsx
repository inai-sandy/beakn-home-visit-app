import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PerformanceCard } from '@/app/(captain)/captain/dashboard/_components/PerformanceCard';
import { DayCloseMetricTiles } from '@/components/today/DayCloseMetricTiles';
import { BestOfPeriodCards } from '@/components/dashboard/BestOfPeriodCards';
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
  loadExecDayClose,
  loadExecLeadsBreakdown,
  loadExecWeeklyReport,
} from '@/lib/captain/exec-drill-queries';
import {
  loadExecBestOfPeriod,
  loadExecCompletedTasksToday,
  loadExecDashboardSummary,
  loadExecPendingTasks,
  loadExecPerformance,
  loadExecPostponedTasksOpen,
} from '@/lib/exec/dashboard-queries';
import {
  getCurrentMonthWindow,
  loadMonthlyTargetPaise,
  loadOneExecTargetProgress,
} from '@/lib/exec/target-progress';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import { loadDayCloseMetrics } from '@/lib/today/metrics';
import { getIstDateString } from '@/lib/today/time';

import { ExecTargetCard } from '@/components/targets/ExecTargetCard';
import { WarningCountsPill } from '@/components/warnings/WarningCountsPill';
import { loadActiveWarningCounts } from '@/lib/warnings/queries';

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

  // HVA-155 follow-up: Best-of-period cards always show a window's worth of
  // data. Single-date dashboard mode silently maps to "last 7 days ending on
  // the picked date" so the cards have something useful to render even when
  // the user hasn't picked a range.
  const bestOfWindow = resolveBestOfWindow(filter);

  // HVA-171: today's plan ONLY drives HeroMetrics (always-today snapshot).
  // The Day Closure tiles consume `dayCloseData` from loadExecDayClose
  // below, which respects the calendar filter (single + range).
  const [todayPlan] = await db
    .select({ id: dayPlans.id, submittedAt: dayPlans.submittedAt })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istDate)))
    .limit(1);

  // Monthly target progress — both meters in a single round-trip.
  const monthWindow = getCurrentMonthWindow();
  const [
    summary,
    pending,
    postponed,
    completed,
    todayMetrics,
    dayCloseData,
    weekly,
    performance,
    leadsBreakdown,
    bestOfPeriod,
    allOutcomeOptions,
    allPostponeReasons,
    monthlyTargetPaise,
    targetProgress,
  ] = await Promise.all([
    loadExecDashboardSummary(user.id),
    loadExecPendingTasks(user.id),
    loadExecPostponedTasksOpen(user.id),
    loadExecCompletedTasksToday(user.id),
    // HVA-171 Fix 5: Hero is locked to TODAY regardless of calendar pick.
    // Skip the helper call when no plan today; HeroMetrics gracefully
    // renders zeros via the empty shape.
    todayPlan
      ? loadDayCloseMetrics({
          execUserId: user.id,
          dayPlanId: todayPlan.id,
          dayPlanSubmittedAt: todayPlan.submittedAt,
          istDateStr: istDate,
        })
      : Promise.resolve(EMPTY_HERO_METRICS),
    // HVA-171 Fix 2: Day Closure tracks the calendar via the same helper
    // the captain drill-down uses. Single-mode + no-plan returns
    // `metrics: null`; range-mode always returns aggregated metrics.
    loadExecDayClose(user.id, filter),
    loadExecWeeklyReport(user.id),
    loadExecPerformance(user.id, filter),
    loadExecLeadsBreakdown(user.id),
    loadExecBestOfPeriod({
      execUserId: user.id,
      from: bestOfWindow.from,
      to: bestOfWindow.to,
    }),
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
    loadMonthlyTargetPaise(),
    loadMonthlyTargetPaise().then((target) =>
      loadOneExecTargetProgress(user.id, monthWindow, target),
    ),
  ]);
  void monthlyTargetPaise; // referenced via targetProgress.targetPaise

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

  const selectedSingleDate =
    filter.mode === 'single' ? filter.date : filter.from;
  const dayCloseLabel = formatSelectedDateLabel(selectedSingleDate);

  const warningCounts = await loadActiveWarningCounts(user.id);

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
      <ExecDashboardHeader filter={filter} />
      {(warningCounts.softActive > 0 || warningCounts.hardActive > 0) && (
        <WarningCountsPill counts={warningCounts} />
      )}
      {targetProgress && (
        <ExecTargetCard progress={targetProgress} window={monthWindow} />
      )}
      <StatusBanner state={summary.banner} />
      <HeroMetrics metrics={todayMetrics} />
      <TasksAccordion
        pending={pending}
        postponed={postponed}
        completed={completed}
        outcomeOptionsByType={groupOutcomeOptions(allOutcomeOptions)}
        postponeReasons={allPostponeReasons}
        linkableRequests={linkableRequests}
        linkableLeads={linkableLeads}
      />
      <p className="text-xs text-muted-foreground">
        Calendar scopes Performance + Day Closure. Weekly Report is always last
        7 vs previous 7. Hero tiles always show today.
      </p>
      <section aria-label="Day closure" className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">Day Closure</h2>
        {dayCloseData.metrics === null ? (
          // HVA-171 Fix 4: single-mode + no plan submitted on the selected
          // past date. Range mode never returns null (aggregates zeros).
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            No day plan submitted on {dayCloseLabel}.
          </div>
        ) : (
          <DayCloseMetricTiles
            metrics={dayCloseData.metrics}
            mode={filter.mode === 'range' ? 'range' : 'single'}
          />
        )}
      </section>
      <WeeklyReportCard data={weekly} />
      <PerformanceCard performance={performance} />
      <BestOfPeriodCards data={bestOfPeriod} windowLabel={bestOfWindow.label} />
      <LeadsEnrolledCard data={leadsBreakdown} />
    </main>
  );
}

// HVA-171: HeroMetrics needs a non-null shape even when the exec hasn't
// submitted today's plan yet. Inline empty value (small enough — and the
// canonical EMPTY_METRICS in lib/captain/exec-drill-queries.ts is module-
// private). Kept local to avoid a cross-module export just for this case.
const EMPTY_HERO_METRICS = {
  taskCounts: {
    done: 0,
    postponed: 0,
    pending: 0,
    totalAtSubmission: 0,
    addedDuringDay: 0,
    fastCompletionCount: 0,
  },
  variancePct: null,
  estimatedTotalMinutes: 0,
  actualTotalMinutes: 0,
  amountCollectedPaise: 0,
  inboundPaymentCount: 0,
  quotationsCount: 0,
  targets: {
    revenue: { actual: 0, target: null, status: 'no_target' as const },
    visits: { actual: 0, target: null, status: 'no_target' as const },
    quotations: { actual: 0, target: null, status: 'no_target' as const },
    orders: { actual: 0, target: null, status: 'no_target' as const },
    conversionPct: { actual: null, target: null, status: 'no_target' as const },
    taskCompletionPct: { actual: null, target: null, status: 'no_target' as const },
  },
};

function formatSelectedDateLabel(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// HVA-155 follow-up: resolve a {from, to, label} for the Best-of-period
// cards. Single-date mode silently maps to a last-7-days window so the
// cards always have useful data to render.
function resolveBestOfWindow(filter: DateFilter): {
  from: string;
  to: string;
  label: string;
} {
  if (filter.mode === 'range') {
    return {
      from: filter.from,
      to: filter.to,
      label: `${formatSelectedDateLabel(filter.from)} – ${formatSelectedDateLabel(filter.to)}`,
    };
  }
  // Single-date → 7-day window ending on the picked date (inclusive).
  const [y, m, d] = filter.date.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);
  const toIsoDate = (date: Date): string =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return {
    from: toIsoDate(start),
    to: toIsoDate(end),
    label: `Last 7 days ending ${formatSelectedDateLabel(filter.date)}`,
  };
}
