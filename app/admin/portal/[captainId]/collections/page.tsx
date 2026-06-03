import type { Metadata } from 'next';

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

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// Full mirror of /captain/collections (Finance), URL-scoped to the
// captain whose portal is being viewed. The 4 hero tiles open the
// same drilldown sheets the captain sees, with per-row links
// retargeted to /admin/portal/[captainId]/requests/[id]-style paths
// (Ship 4 work — for now we use /requests/[id] which works for both).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance — Beakn admin',
};

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    section?: string;
    exec?: string;
    city?: string;
    q?: string;
    page?: string;
    sort?: string;
  }>;
}

export default async function AdminPortalCollectionsPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = (await params) as { captainId: string };
  const sp = await searchParams;
  const section = parseFinanceSection(sp.section);
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;
  const search = (sp.q ?? '').trim();
  const page = parsePage(sp.page);
  const sort = parseFinanceListSort(sp.sort);
  const basePath = `/admin/portal/${captainId}/collections`;

  const sharedScope = {
    captainUserId: captainId,
    isSuperAdmin: false,
    execFilter,
    cityFilter,
  };

  const [snapshot, buckets, list] = await Promise.all([
    loadFinanceSnapshot({ ...sharedScope, search }),
    loadFinanceAgingBuckets({ ...sharedScope, search }),
    loadFinanceOrderList({
      ...sharedScope,
      section,
      search,
      page,
      sort,
    }),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground">
            Order book, quotation pipeline, payments received, and
            outstanding across this captain's team.
          </p>
        </header>
        <ViewOnlyNotice message="Recording payments is captain / exec only. Tap any tile for a detailed breakdown." />

        <FinanceSnapshot snapshot={snapshot} basePath={basePath} />

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
            basePath={basePath}
          />
        </div>

        <FinanceOrderList
          rows={list.rows}
          pageRange={list.pageRange}
          currentSort={sort}
          basePath={basePath}
          section={section}
        />
      </div>
    </main>
  );
}
