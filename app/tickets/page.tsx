import { redirect } from 'next/navigation';

import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import {
  loadTicketsQueue,
  type TicketCategoryFilter,
  type TicketStatusFilter,
} from '@/lib/support-tickets/queue-queries';

import { TicketsQueueClient } from './_components/TicketsQueueClient';

// =============================================================================
// HVA-255 (HVA-232 Phase 2): /tickets queue page
// =============================================================================
//
// Visible to sales_executive (their own request's tickets), captain (their
// city's tickets), super_admin (all). URL-driven filters: status, category,
// search, mine, page.
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

function parseStatus(raw: string | undefined): TicketStatusFilter {
  if (raw === 'open' || raw === 'in_progress' || raw === 'resolved' || raw === 'all') {
    return raw;
  }
  return 'open';
}
function parseCategory(raw: string | undefined): TicketCategoryFilter {
  if (
    raw === 'complaint' ||
    raw === 'warranty' ||
    raw === 'refund' ||
    raw === 'other' ||
    raw === 'all'
  ) {
    return raw;
  }
  return 'all';
}

export default async function TicketsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/tickets');
  const user = session.user as { id: string; role?: string };

  if (
    user.role !== USER_ROLES.SALES_EXECUTIVE &&
    user.role !== USER_ROLES.CAPTAIN &&
    user.role !== USER_ROLES.SUPER_ADMIN
  ) {
    redirect('/login');
  }

  const params = await searchParams;
  const status = parseStatus(params.status);
  const category = parseCategory(params.category);
  const mineOnly = params.mine === '1';
  const search = (params.q ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const queue = await loadTicketsQueue({
    callerRole: user.role as 'sales_executive' | 'captain' | 'super_admin',
    callerUserId: user.id,
    status,
    category,
    mineOnly,
    search: search || undefined,
    page,
    pageSize: 25,
  });

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Customer-raised support tickets. Click <strong>Take this</strong> to
            claim one; the customer sees your status update on their tracking
            page within seconds.
          </p>
        </header>

        <TicketsQueueClient
          rows={queue.rows}
          status={status}
          category={category}
          mineOnly={mineOnly}
          search={search}
          page={queue.page}
          pageSize={queue.pageSize}
          totalCount={queue.totalCount}
          currentRole={user.role as 'sales_executive' | 'captain' | 'super_admin'}
        />
      </div>
    </main>
  );
}
