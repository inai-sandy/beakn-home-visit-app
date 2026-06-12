import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import {
  leads,
  outcomeOptions,
  postponeReasons as postponeReasonsTable,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import type { DateFilter } from '@/lib/captain/dashboard-queries';
import {
  loadExecCompletedTasksToday,
  loadExecContactsCaptured,
  loadExecDashboardSummary,
  loadExecPendingTasks,
  loadExecPostponedTasksOpen,
  loadExecTaskWindowCounts,
} from '@/lib/exec/dashboard-queries';
import { loadVisitedRequestsCount } from '@/lib/metrics/conversion';
import { loadMetrics } from '@/lib/metrics/registry';
import {
  getCurrentMonthWindow,
  loadMonthlyTargetPaise,
  loadOneExecTargetProgress,
} from '@/lib/exec/target-progress';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import { getIstDateString } from '@/lib/today/time';

import { ExecStreakLine } from '@/components/leaderboard/ExecStreakLine';
import { ExecTargetCard } from '@/components/targets/ExecTargetCard';
import { loadStreakForExec } from '@/lib/leaderboard/streak';
import { loadActiveWarningCounts } from '@/lib/warnings/queries';

import { ExecDashboardHeader } from './_components/ExecDashboardHeader';
import { NextUpCard } from './_components/NextUpCard';
import { PendingOnMeCard } from './_components/PendingOnMeCard';
import { TasksAccordion } from './_components/TasksAccordion';
import { WindowTiles } from './_components/WindowTiles';

// =============================================================================
// HVA-277: /dashboard — redesigned exec analytical surface
// =============================================================================
//
// Sandeep 2026-06-12: "change every dashboard… it has to be neat and
// clear. the info has to modify every tile when we change the dates."
//
// The one-clock contract:
//
//   1. ExecDashboardHeader  — title + ONE from/to picker (up to a year back)
//   2. WindowTiles          — EVERY tile recomputes for the picked window
//                             (SSOT registry + window helpers; no parallel
//                             query paths, no fixed-window cards)
//   3. NextUpCard           — the live answer to "what should I do now?"
//                             (as-of-now tag)
//   4. PendingOnMeCard      — overdue tasks / money to collect / warnings
//                             (as-of-now tag)
//   5. TasksAccordion       — THE action list (today's operational tasks)
//   6. ExecTargetCard       — compact month pacing strip
//   7. ExecStreakLine       — one-line motivation
//
// Removed from the old page: HeroMetrics + StatusBanner (replaced by
// NextUpCard), DayCloseMetricTiles section, WeeklyReportCard (fixed
// last-7 window — pick 7 days instead), BestOfPeriodCards,
// LeadsEnrolledCard (lifetime — now the window-driven Contacts tile).
//
// Date handling: invalid or out-of-range params CLAMP instead of the
// old silent reset-to-today — that reset is exactly how "I picked 31
// days and it landed in today" happened (the validator rejected
// anything past 30 days back).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Beakn',
  description: 'Your numbers, your dates.',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_BACK = 365;

function isoOffset(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Clamp an incoming date param into [today − 365, today]. Returns null
 *  only for unparseable input. Clamping (not resetting) keeps the user's
 *  intent — asking for "too far back" lands on the oldest allowed day,
 *  never silently on today. */
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
  const istToday = getIstDateString();
  const filter = parseDateFilter(raw, istToday);
  const range =
    filter.mode === 'range'
      ? { fromDate: filter.from, toDate: filter.to }
      : { fromDate: filter.date, toDate: filter.date };

  const scope = { execUserId: user.id };
  const monthWindow = getCurrentMonthWindow();

  const [
    windowMetrics,
    visitedRequests,
    taskWindowCounts,
    contactsCaptured,
    summary,
    pending,
    postponed,
    completed,
    warningCounts,
    streakSummary,
    allOutcomeOptions,
    allPostponeReasons,
    targetProgress,
  ] = await Promise.all([
    // One SSOT round-trip for every registry-backed tile.
    loadMetrics(
      [
        'revenue',
        'orders_value',
        'orders_count',
        'conversion_pct',
        'quotations_count',
        'outstanding',
      ] as const,
      scope,
      range,
    ),
    loadVisitedRequestsCount(scope, range),
    loadExecTaskWindowCounts(user.id, range.fromDate, range.toDate),
    loadExecContactsCaptured(user.id, range.fromDate, range.toDate),
    loadExecDashboardSummary(user.id),
    loadExecPendingTasks(user.id),
    loadExecPostponedTasksOpen(user.id),
    loadExecCompletedTasksToday(user.id),
    loadActiveWarningCounts(user.id),
    loadStreakForExec(user.id),
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
    loadMonthlyTargetPaise().then((target) =>
      loadOneExecTargetProgress(user.id, getCurrentMonthWindow(), target),
    ),
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

  const overdueCount = postponed.filter(
    (t) => t.postponedToDate !== null && t.postponedToDate < istToday,
  ).length;

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
      <ExecDashboardHeader filter={filter} />
      <WindowTiles
        collectedPaise={windowMetrics.revenue ?? 0}
        bookedPaise={windowMetrics.orders_value ?? 0}
        visitedRequests={visitedRequests}
        ordersCount={windowMetrics.orders_count ?? 0}
        conversionPct={windowMetrics.conversion_pct}
        quotationsCount={windowMetrics.quotations_count ?? 0}
        contactsCaptured={contactsCaptured}
        tasksDone={taskWindowCounts.done}
        tasksTotal={taskWindowCounts.total}
      />
      <NextUpCard banner={summary.banner} nextTask={pending[0] ?? null} />
      <PendingOnMeCard
        overdueCount={overdueCount}
        outstandingPaise={windowMetrics.outstanding ?? 0}
        warnings={{ soft: warningCounts.softActive, hard: warningCounts.hardActive }}
      />
      <TasksAccordion
        pending={pending}
        postponed={postponed}
        completed={completed}
        outcomeOptionsByType={groupOutcomeOptions(allOutcomeOptions)}
        postponeReasons={allPostponeReasons}
        linkableRequests={linkableRequests}
        linkableLeads={linkableLeads}
      />
      {targetProgress && (
        <ExecTargetCard progress={targetProgress} window={monthWindow} />
      )}
      <ExecStreakLine summary={streakSummary} />
    </main>
  );
}
