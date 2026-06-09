import { TicketsQueueClient } from '@/components/tickets/TicketsQueueClient';
import { loadTicketsPageData } from '@/lib/support-tickets/page-helpers';

// =============================================================================
// HVA-256-FIX1: /admin/tickets — admin portal version of the queue
// =============================================================================
//
// Mounted under /admin so the admin sidebar shell wraps it. Scope = ALL
// tickets across all cities/teams (super_admin sees everything).
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
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            All customer-raised support tickets, every city, every team.
            Resolve directly or watch the queue.
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
    </main>
  );
}
