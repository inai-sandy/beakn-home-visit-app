import { TicketsQueueClient } from '@/components/tickets/TicketsQueueClient';
import { loadTicketsPageData } from '@/lib/support-tickets/page-helpers';

// =============================================================================
// HVA-256-FIX2: /admin/tickets — admin portal version of the queue
// =============================================================================
//
// Layout pattern matches /admin/operations/requests:
// `<div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">`
// with the eyebrow + bold heading the admin layout uses everywhere.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Tickets — Admin — Beakn',
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

export default async function AdminTicketsPage({ searchParams }: PageProps) {
  const data = await loadTicketsPageData({
    portalPath: '/admin/tickets',
    requiredRole: 'super_admin',
    searchParams,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
          Operations
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
          Customer Tickets
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.queue.totalCount === 0
            ? 'No customer support tickets across any city right now.'
            : `${data.queue.totalCount} ticket${data.queue.totalCount === 1 ? '' : 's'} across every city and team.`}
        </p>
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
