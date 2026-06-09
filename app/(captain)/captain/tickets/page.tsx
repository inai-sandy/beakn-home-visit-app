import { TicketsQueueClient } from '@/components/tickets/TicketsQueueClient';
import { loadTicketsPageData } from '@/lib/support-tickets/page-helpers';

// =============================================================================
// HVA-256-FIX1: /captain/tickets — captain portal version of the queue
// =============================================================================
//
// Mounted INSIDE the (captain) route group so the captain sidebar shell
// wraps it. Was previously a top-level /tickets route which rendered
// outside the captain portal (visual mismatch, no sidebar). Captain
// visibility scope is now team-based (assigned_exec reports to me) —
// not city-based — matching the rule used everywhere else.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Tickets — Captain — Beakn',
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

export default async function CaptainTicketsPage({ searchParams }: PageProps) {
  const data = await loadTicketsPageData({
    portalPath: '/captain/tickets',
    requiredRole: 'captain',
    searchParams,
  });

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          Customer-raised support tickets across your team. Click{' '}
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
