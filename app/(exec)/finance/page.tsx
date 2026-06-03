import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import {
  loadFinanceAgingBuckets,
  loadFinanceOrderList,
  loadFinanceSnapshot,
  parseFinanceListSort,
  parseFinanceSection,
} from '@/lib/captain/finance-queries';
import { parsePage } from '@/lib/pagination';

import { FinanceAgingBuckets } from '@/app/(captain)/captain/collections/_components/FinanceAgingBuckets';
import { FinanceFiltersBar } from '@/app/(captain)/captain/collections/_components/FinanceFiltersBar';
import { FinanceMethodologyNote } from '@/app/(captain)/captain/collections/_components/FinanceMethodologyNote';
import { FinanceOrderList } from '@/app/(captain)/captain/collections/_components/FinanceOrderList';
import { FinanceSnapshot } from '@/app/(captain)/captain/collections/_components/FinanceSnapshot';

// =============================================================================
// PR13 2026-05-27: /finance — sales exec self-view of finance dashboard
// =============================================================================
//
// Mirrors /captain/collections (same snapshot tiles + aging buckets +
// methodology + filters + sort + paginated list + payment calendar).
// The only difference is scope: queries pin to
// visit_requests.assigned_exec_user_id = self via the `forceExecScope`
// option, bypassing the captain team-scope helper. No exec or city
// dropdowns — the exec is the singular subject of the view.
//
// URL contract:
//   ?section=all|order_book|pipeline   (default 'all')
//   ?q=<text>                          (default '')
//   ?sort=…                            (default outstanding_desc)
//   ?page=<n>                          (default 1)
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance — Beakn',
  description: 'Your order book, pipeline, received, outstanding.',
};

interface PageProps {
  searchParams: Promise<{
    section?: string;
    q?: string;
    page?: string;
    sort?: string;
  }>;
}

export default async function ExecFinancePage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/finance');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const sp = await searchParams;
  const section = parseFinanceSection(sp.section);
  const search = (sp.q ?? '').trim();
  const page = parsePage(sp.page);
  const sort = parseFinanceListSort(sp.sort);

  // For the exec self-view, captainUserId + isSuperAdmin are unused
  // (the `forceExecScope` option overrides). Pass user.id as a benign
  // placeholder.
  const sharedArgs = {
    captainUserId: user.id,
    isSuperAdmin: false,
    forceExecScope: user.id,
    search,
  } as const;

  const [snapshot, buckets, list] = await Promise.all([
    loadFinanceSnapshot({ ...sharedArgs }),
    loadFinanceAgingBuckets({ ...sharedArgs }),
    loadFinanceOrderList({ ...sharedArgs, section, page, sort }),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <header className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your order book, quotation pipeline, payments received, and
              outstanding amounts. Tap a row to drill into the customer
              request.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/calendar">
              <Icon name="calendar_month" size="xs" />
              Payment Calendar
            </Link>
          </Button>
        </header>

        <FinanceSnapshot snapshot={snapshot} basePath="/finance" />

        <FinanceMethodologyNote />

        <div
          id="finance-list"
          className="scroll-mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3"
        >
          <FinanceAgingBuckets buckets={buckets} />
          <FinanceFiltersBar
            team={[]}
            cities={[]}
            currentSection={section}
            currentExec="all"
            currentCity="all"
            currentSearch={search}
            basePath="/finance"
          />
        </div>

        <FinanceOrderList
          rows={list.rows}
          pageRange={list.pageRange}
          section={section}
          currentSort={sort}
          basePath="/finance"
        />
      </div>
    </main>
  );
}
