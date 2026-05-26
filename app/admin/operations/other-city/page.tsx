import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadActiveCaptainsForRouting,
  loadOtherCityQueue,
} from '@/lib/admin/other-city-queue';
import {
  DEFAULT_PAGE_SIZE,
  computePageRange,
  parsePage,
} from '@/lib/pagination';

import { OtherCityQueueClient } from './other-city-client';

// =============================================================================
// HVA-95 + B2 2026-05-26: /admin/operations/other-city — pagination + search
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Other-city Queue — Admin',
};

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string }>;
}

export default async function AdminOtherCityQueuePage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/operations/other-city');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const search = (sp.q ?? '').trim();

  const [queue, captains] = await Promise.all([
    loadOtherCityQueue({ page, pageSize: DEFAULT_PAGE_SIZE, search }),
    loadActiveCaptainsForRouting(),
  ]);

  const pageRange = computePageRange({
    page,
    total: queue.total,
  });

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Other-city Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Requests submitted from outside the 8 service cities. Manually
            route each one to a captain. Captain will then assign to their
            sales exec via the normal flow.
          </p>
        </header>
        <OtherCityQueueClient
          requests={queue.rows}
          captains={captains}
          total={queue.total}
          pageRange={pageRange}
          currentSearch={search}
        />
      </div>
    </main>
  );
}
