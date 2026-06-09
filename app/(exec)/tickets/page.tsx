import { TicketsQueueClient } from '@/components/tickets/TicketsQueueClient';
import { loadTicketsPageData } from '@/lib/support-tickets/page-helpers';

// =============================================================================
// HVA-256-FIX2: /tickets — exec portal version of the queue
// =============================================================================
//
// Mounted in the (exec) route group so the exec shell wraps it.
// Layout pattern matches the other exec pages: outer wrapper is
// `p-4 sm:p-6 lg:p-8 max-w-5xl space-y-5` (no fresh <main>).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Tickets — Beakn',
};

interface PageProps {
  searchParams: Promise<{
    status?: string;
    category?: string;
    mine?: string;
    q?: string;
    page?: string;
  }>;
}

export default async function ExecTicketsPage({ searchParams }: PageProps) {
  const data = await loadTicketsPageData({
    portalPath: '/tickets',
    requiredRole: 'sales_executive',
    searchParams,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.queue.totalCount === 0
              ? 'No support tickets on your assigned requests right now.'
              : `${data.queue.totalCount} ticket${data.queue.totalCount === 1 ? '' : 's'} on your assigned requests.`}
          </p>
        </div>
      </header>

      <TicketsQueueClient
        rows={data.queue.rows}
        status={data.status}
        category={data.category}
        mineOnly={data.mineOnly}
        search={data.search}
        page={data.page}
        pageSize={data.queue.pageSize}
        totalCount={data.queue.totalCount}
        currentRole={data.currentRole}
        categories={data.categories}
      />
    </div>
  );
}
