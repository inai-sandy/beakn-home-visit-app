import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DashboardHeader } from '@/app/(captain)/captain/dashboard/_components/DashboardHeader';
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
import { getIstDateString } from '@/lib/today/time';

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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_BACK = 365;

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
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  const user = session.user as { name?: string; email?: string; role?: string };
  if (user.role !== 'super_admin') redirect('/login');

  const raw = await searchParams;
  const istToday = getIstDateString();
  const filter = parseDateFilter(raw, istToday);
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
      <DashboardHeader
        filter={filter}
        pathname="/admin/dashboard"
        maxDaysBack={365}
        subtitle="Org-wide numbers for the dates you pick."
      />

      <FirstTimeSetupBanner status={setupStatus} />

      <AdminDashboardHero
        displayName={displayName}
        collectedPaise={windowMetrics.collectedPaise}
        previousPaise={compareMetrics?.collectedPaise ?? null}
        comparisonLabel={resolved.comparisonLabel}
      />

      <AdminKpiTiles window={windowMetrics} compare={compareMetrics} />

      <AdminCityGrid cards={cityCards} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminRevenuePanel revenue={revenue} counts={counts} />
        <AdminAlertsFeed alerts={alerts} />
      </div>
    </main>
  );
}
