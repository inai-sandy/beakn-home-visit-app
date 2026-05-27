import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  loadFinanceAgingBuckets,
  loadFinanceOrderList,
  loadFinanceSnapshot,
  loadFinanceTeamRoster,
  parseFinanceSection,
} from '@/lib/captain/finance-queries';
import { parsePage } from '@/lib/pagination';

import { FinanceAgingBuckets } from './_components/FinanceAgingBuckets';
import { FinanceFiltersBar } from './_components/FinanceFiltersBar';
import { FinanceMethodologyNote } from './_components/FinanceMethodologyNote';
import { FinanceOrderList } from './_components/FinanceOrderList';
import { FinanceSnapshot } from './_components/FinanceSnapshot';

// =============================================================================
// PR12 2026-05-26: /captain/collections — captain finance dashboard
// =============================================================================
//
// Replaces the HVA-78 "Coming soon" stub. Combines four sub-surfaces:
//
//   1. Money snapshot tiles (4 across) — Order Book / Quotation
//      Pipeline / Received / Outstanding
//   2. Aging buckets (3 stacked bars) — 0-7 / 8-30 / 30+ days
//   3. Filter bar — search + exec + city dropdowns + section pills
//      (All / Order Book / Pipeline)
//   4. Order list — paginated 10/page, mobile cards + desktop table,
//      each row links to /requests/[id]
//
// URL contract:
//   ?section=all|order_book|pipeline   (default 'all')
//   ?exec=<userId>                     (default 'all')
//   ?city=<cityId>                     (default 'all')
//   ?q=<text>                          (default '')
//   ?page=<n>                          (default 1)
//
// Visibility: team-scope via buildCaptainRequestVisibilityWhere
// (captains can't see other captains' team work, except for
// unaccepted-in-my-cities discovery).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance — Captain',
  description: 'Pending collections, order book, and payment overview',
};

interface PageProps {
  searchParams: Promise<{
    section?: string;
    exec?: string;
    city?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function CaptainCollectionsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/collections');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }
  const isAdmin = user.role === 'super_admin';

  const sp = await searchParams;
  const section = parseFinanceSection(sp.section);
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;
  const search = (sp.q ?? '').trim();
  const page = parsePage(sp.page);

  const [snapshot, buckets, list, team, captainCities] = await Promise.all([
    loadFinanceSnapshot({
      captainUserId: user.id,
      isSuperAdmin: isAdmin,
      execFilter,
      cityFilter,
      search,
    }),
    loadFinanceAgingBuckets({
      captainUserId: user.id,
      isSuperAdmin: isAdmin,
      execFilter,
      cityFilter,
      search,
    }),
    loadFinanceOrderList({
      captainUserId: user.id,
      isSuperAdmin: isAdmin,
      section,
      execFilter,
      cityFilter,
      search,
      page,
    }),
    loadFinanceTeamRoster(user.id, isAdmin),
    isAdmin ? Promise.resolve([]) : loadCaptainCities(user.id),
  ]);

  // Defence-in-depth: drop URL-supplied filter values that aren't in
  // the captain's visible scope.
  const cityWhitelist = new Set(captainCities.map((c) => c.id));
  const safeCity =
    cityFilter && (isAdmin || cityWhitelist.has(cityFilter)) ? cityFilter : 'all';
  const execWhitelist = new Set(team.map((t) => t.userId));
  const safeExec =
    execFilter && (isAdmin || execWhitelist.has(execFilter))
      ? execFilter
      : 'all';

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <header className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pending collections, order book, and the quotation pipeline.
              Tap a row to drill into the customer request.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/captain/collections/calendar">
              <Icon name="calendar_month" size="xs" />
              Payment Calendar
            </Link>
          </Button>
        </header>

        <FinanceSnapshot snapshot={snapshot} />

        <FinanceMethodologyNote />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <FinanceAgingBuckets buckets={buckets} />
          <FinanceFiltersBar
            team={team}
            cities={captainCities}
            currentSection={section}
            currentExec={safeExec}
            currentCity={safeCity}
            currentSearch={search}
          />
        </div>

        <FinanceOrderList
          rows={list.rows}
          pageRange={list.pageRange}
          section={section}
        />
      </div>
    </main>
  );
}
