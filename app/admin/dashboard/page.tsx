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
import { addDaysIst } from '@/lib/date';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadMonthlyTargetPaise,
} from '@/lib/exec/target-progress';
import { getIstDateString } from '@/lib/today/time';

import { TeamTargetArena } from '@/components/targets/TeamTargetArena';

import { AdminAlertsFeed } from './_components/AdminAlertsFeed';
import { AdminCityGrid } from './_components/AdminCityGrid';
import { AdminDashboardHero } from './_components/AdminDashboardHero';
import { AdminKpiTiles } from './_components/AdminKpiTiles';
import { AdminRevenuePanel } from './_components/AdminRevenuePanel';
import { FirstTimeSetupBanner } from './_components/FirstTimeSetupBanner';

// =============================================================================
// HVA-88 + HVA-117 redesign: super_admin dashboard — Premium fintech treatment
// =============================================================================
//
// Visual hierarchy (top → bottom):
//   1. First-time setup banner (only visible while seed work is incomplete)
//   2. Hero — greeting + today's revenue with delta vs yesterday
//   3. KPI strip — 4 tiles (Visits / Orders / Conversion% / Productive)
//   4. Cities — primary content. Per-city cards with status pills, tap →
//      /admin/operations/cities/[cityId] (admin shell, not captain)
//   5. Bottom row (2-col @ lg+, stacked on mobile):
//      - Revenue & Pipeline panel (consolidates the old Revenue + Counts)
//      - Alerts feed
//
// Yesterday's metrics are loaded in parallel with today's so the hero
// and KPI tiles can render comparison deltas without a second roundtrip.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Command Center — Beakn admin',
};

export default async function AdminDashboardPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  const user = session.user as { name?: string; email?: string; role?: string };
  if (user.role !== 'super_admin') redirect('/login');

  const istToday = getIstDateString();
  const istYesterday = getIstDateString(addDaysIst(new Date(), -1));

  const monthWindow = getCurrentMonthWindow();
  // Every query fires in parallel — TTFB bounded by the slowest, not the sum.
  const [
    setupStatus,
    todayMetrics,
    yesterdayMetrics,
    revenue,
    counts,
    cityCards,
    alerts,
    monthlyTargetPaise,
  ] = await Promise.all([
    loadFirstTimeSetupStatus(),
    loadAdminGlobalMetrics(istToday),
    loadAdminGlobalMetrics(istYesterday),
    loadAdminRevenueSnapshot(istToday),
    loadAdminCounts(istToday),
    loadCityCards(istToday),
    loadAdminAlerts(),
    loadMonthlyTargetPaise(),
  ]);
  // Per-exec target rows for the arena. Runs in a second round-trip since
  // it depends on monthlyTargetPaise.
  const allExecTargetRows = await loadAllExecTargetProgress(
    monthWindow,
    monthlyTargetPaise,
  );

  const displayName = user.name ?? user.email ?? 'Admin';

  return (
    <main className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1600px] mx-auto">
      <FirstTimeSetupBanner status={setupStatus} />

      <AdminDashboardHero
        displayName={displayName}
        todayRevenuePaise={todayMetrics.collectionsTodayPaise}
        yesterdayRevenuePaise={yesterdayMetrics.collectionsTodayPaise}
      />

      <AdminKpiTiles today={todayMetrics} yesterday={yesterdayMetrics} />

      <TeamTargetArena
        rows={allExecTargetRows}
        window={monthWindow}
        title="All executives — monthly targets"
      />

      <AdminCityGrid cards={cityCards} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminRevenuePanel revenue={revenue} counts={counts} />
        <AdminAlertsFeed alerts={alerts} />
      </div>
    </main>
  );
}
