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
import { getIstDateString } from '@/lib/today/time';

import { AlertsFeed } from './_components/AlertsFeed';
import { CityCardGrid } from './_components/CityCardGrid';
import { FirstTimeSetupBanner } from './_components/FirstTimeSetupBanner';
import { GlobalAggregatesColumn } from './_components/GlobalAggregatesColumn';

// HVA-88: super_admin dashboard. Three-column layout matching the captain +
// exec dashboards in concept: left = global aggregates, middle = per-city
// cards, right = alerts feed. Pinned first-time-setup banner above the grid
// until cities + captains + execs are all populated.
//
// SSE is out of scope (Phase 2 per CLAUDE.md). The page is force-dynamic so
// each navigation re-fetches; no client-side polling.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard — Beakn admin',
};

export default async function AdminDashboardPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  const role = (session.user as { role?: string }).role;
  if (role !== 'super_admin') redirect('/login');

  const istToday = getIstDateString();

  // Fan out every query in parallel — the dashboard's TTFB is bounded by the
  // slowest of these, not their sum.
  const [setupStatus, metrics, revenue, counts, cityCards, alerts] =
    await Promise.all([
      loadFirstTimeSetupStatus(),
      loadAdminGlobalMetrics(istToday),
      loadAdminRevenueSnapshot(istToday),
      loadAdminCounts(istToday),
      loadCityCards(istToday),
      loadAdminAlerts(),
    ]);

  return (
    <main className="p-4 sm:p-6 lg:p-8 space-y-5 max-w-[1600px] mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          System-wide view across every city, captain, and exec.
        </p>
      </header>

      <FirstTimeSetupBanner status={setupStatus} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_2fr_minmax(280px,1fr)] gap-5">
        <GlobalAggregatesColumn
          metrics={metrics}
          revenue={revenue}
          counts={counts}
        />
        <CityCardGrid cards={cityCards} />
        <AlertsFeed alerts={alerts} />
      </div>
    </main>
  );
}
