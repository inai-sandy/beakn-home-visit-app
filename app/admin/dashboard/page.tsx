import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadAdminAlerts,
  loadAdminCounts,
  loadAdminGlobalMetrics,
  loadAdminRevenueSnapshot,
  loadCityCards,
  loadFirstTimeSetupStatus,
} from '@/lib/admin/dashboard-queries';
import {
  resolveDateFilter,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { getCurrentMonthWindow } from '@/lib/exec/target-progress';
import { financialYearToDate } from '@/lib/date';
import { getIstDateString } from '@/lib/today/time';

import { DashboardTabNav } from '@/components/dashboard/DashboardTabNav';

import { AdminAlertsFeed } from './_components/AdminAlertsFeed';
import { AdminCityGrid } from './_components/AdminCityGrid';
import { AdminDashboardHero } from './_components/AdminDashboardHero';
import { AdminKpiTiles } from './_components/AdminKpiTiles';
import { AdminRevenuePanel } from './_components/AdminRevenuePanel';
import { FirstTimeSetupBanner } from './_components/FirstTimeSetupBanner';

// =============================================================================
// HVA-279: super_admin dashboard — one from–to picker rules every number
// =============================================================================
//
// Sandeep 2026-06-12: "change every dashboard… the info has to modify
// every tile when we change the dates." The old page had NO date
// control at all — everything was hardcoded today-vs-yesterday.
//
// Composition (top → bottom):
//   1. DashboardHeader      — title + the one from/to picker (≤365 days)
//   2. FirstTimeSetupBanner — unchanged
//   3. Hero                 — Collected ₹ for the window, delta vs the
//                             previous same-length period
//   4. KPI strip            — Booked / Visits / Orders / Conversion /
//                             Productive, all window-driven with deltas
//   5. City grid            — per-city numbers for the window ("not
//                             started" sub-stat stays as-of-today)
//   6. Money & pipeline     — windowed Collected/Delivered/Cancelled +
//                             clearly-tagged AS-OF-NOW snapshots
//                             (Outstanding / Open quotation / Open
//                             requests / Pending approvals)
//   7. Alerts feed          — as-of-now
//
// Date params CLAMP into [today − 365, today] — never a silent reset.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Command Center — Beakn admin',
};

// HVA-290: admin uses three fixed-preset tabs (no free calendar) — the
// tab IS the range. The label under the tabs reflects the active window.
const ADMIN_TABS = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'overall', label: 'Overall' },
];

/** Derive the date filter + a label from the active admin tab. */
function filterForView(
  view: string,
  istToday: string,
): { filter: DateFilter; label: string } {
  if (view === 'month') {
    const m = getCurrentMonthWindow();
    return {
      filter: { mode: 'range', from: m.monthStart, to: istToday },
      label: `${m.monthLabel} · to date`,
    };
  }
  if (view === 'overall') {
    const fy = financialYearToDate(istToday);
    return {
      filter: { mode: 'range', from: fy.fromDate, to: fy.toDate },
      label: 'Financial year · to date',
    };
  }
  return { filter: { mode: 'single', date: istToday }, label: 'Today' };
}

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  const user = session.user as { name?: string; email?: string; role?: string };
  if (user.role !== 'super_admin') redirect('/login');

  const raw = await searchParams;
  const istToday = getIstDateString();
  const view =
    raw.view === 'month' || raw.view === 'overall' ? raw.view : 'today';
  const { filter, label: rangeLabel } = filterForView(view, istToday);
  const resolved = resolveDateFilter(filter);
  const window = { fromDate: resolved.target.from, toDate: resolved.target.to };
  const compareWindow = resolved.compare
    ? { fromDate: resolved.compare.from, toDate: resolved.compare.to }
    : null;

  // Every query fires in parallel — TTFB bounded by the slowest, not the sum.
  const [
    setupStatus,
    windowMetrics,
    compareMetrics,
    revenue,
    counts,
    cityCards,
    alerts,
  ] = await Promise.all([
    loadFirstTimeSetupStatus(),
    loadAdminGlobalMetrics(window),
    compareWindow
      ? loadAdminGlobalMetrics(compareWindow)
      : Promise.resolve(null),
    loadAdminRevenueSnapshot(window),
    loadAdminCounts(window),
    loadCityCards(window, istToday),
    loadAdminAlerts(),
  ]);

  const displayName = user.name ?? user.email ?? 'Admin';

  return (
    <main className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1600px] mx-auto">
      <div className="flex flex-col items-center gap-2">
        <DashboardTabNav tabs={ADMIN_TABS} active={view} />
        <p className="text-xs text-muted-foreground">{rangeLabel}</p>
      </div>

      <FirstTimeSetupBanner status={setupStatus} />

      <AdminDashboardHero
        displayName={displayName}
        collectedPaise={windowMetrics.collectedPaise}
        previousPaise={compareMetrics?.collectedPaise ?? null}
        comparisonLabel={resolved.comparisonLabel}
      />

      <AdminKpiTiles window={windowMetrics} compare={compareMetrics} />

      {/* HVA-292: Revenue & pipeline promoted to a full-width row near the
          top (was a cramped half-width card at the bottom where its labels
          truncated). */}
      <AdminRevenuePanel revenue={revenue} counts={counts} />

      <AdminCityGrid cards={cityCards} />

      <AdminAlertsFeed alerts={alerts} />
    </main>
  );
}
