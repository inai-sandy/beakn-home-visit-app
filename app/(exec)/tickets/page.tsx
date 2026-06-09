import { TicketsQueueClient } from '@/components/tickets/TicketsQueueClient';
import { loadTicketsPageData } from '@/lib/support-tickets/page-helpers';

// =============================================================================
// HVA-256-FIX1: /tickets — exec portal version of the queue
// =============================================================================
//
// Mounted in the (exec) route group so the exec drawer/topbar shell
// wraps the page. Scope = tickets on requests assigned to this exec.
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
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          Customer-raised support tickets on your assigned requests. Click{' '}
          <strong>Take this</strong> to claim one; the customer sees your
          status update on their tracking page within seconds.
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
    </section>
  );
}
