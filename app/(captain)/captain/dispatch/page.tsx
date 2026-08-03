import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  DispatchQueueView,
  type DispatchQueueMode,
} from '@/components/dispatch/DispatchQueueView';
import { getServerSession } from '@/lib/auth-server';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  loadDispatchQueue,
  loadDispatchQueueSummary,
  type DispatchQueueScope,
} from '@/lib/support/dispatch-queries';

// =============================================================================
// HVA-308: /captain/dispatch — the captain's centralized pending-to-ship list
// =============================================================================
//
// Same screen as the exec's, scoped to the captain's team via the exact
// predicate their Requests tab uses (buildRequestsScopeWhere), so the two
// screens can never disagree about which orders are theirs.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dispatch — Captain — Beakn',
  description: "Products still to be shipped across your team's orders.",
};

const PAGE_SIZE = 25;

function parseMode(raw: string | undefined): DispatchQueueMode {
  return raw === 'pending' || raw === 'in_progress' ? raw : 'all';
}

interface PageProps {
  searchParams: Promise<{ mode?: string; page?: string }>;
}

export default async function CaptainDispatchPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/dispatch');

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === 'super_admin';
  if (!isAdmin && actor.role !== 'captain') redirect('/login');

  const params = await searchParams;
  const mode = parseMode(params.mode);
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const myCities = isAdmin ? [] : await loadCaptainCities(actor.id);

  const scope: DispatchQueueScope = isAdmin
    ? { kind: 'all' }
    : {
        kind: 'captain',
        captainUserId: actor.id,
        cityIds: myCities.map((c) => c.id),
        isSuperAdmin: false,
      };

  const options = { scope, mode, page, pageSize: PAGE_SIZE };
  const [queue, summary] = await Promise.all([
    loadDispatchQueue(options),
    loadDispatchQueueSummary(options),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl">
      <DispatchQueueView
        rows={queue.rows}
        summary={summary}
        mode={mode}
        basePath="/captain/dispatch"
        page={queue.page}
        pageSize={queue.pageSize}
        totalCount={queue.totalCount}
        showCustomerOwner
        subtitle={
          isAdmin
            ? 'Every product still to be shipped, across every city.'
            : "Products still to be shipped across your team's confirmed orders."
        }
      />
    </div>
  );
}
