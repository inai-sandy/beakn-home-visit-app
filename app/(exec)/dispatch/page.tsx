import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  DispatchQueueView,
  type DispatchQueueMode,
} from '@/components/dispatch/DispatchQueueView';
import { getServerSession } from '@/lib/auth-server';
import {
  loadDispatchQueue,
  loadDispatchQueueSummary,
  type DispatchQueueScope,
} from '@/lib/support/dispatch-queries';

// =============================================================================
// HVA-308: /dispatch — the exec's centralized pending-to-ship list
// =============================================================================
//
// Answers "what do I still owe my customers" across every order at once.
// The HVA-305 pill answers that per order; this answers it in aggregate,
// product by product, which is what an exec is actually asked on a call.
//
// Read-only — support performs the dispatch.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dispatch — Beakn',
  description: 'Products still to be shipped on your orders.',
};

const PAGE_SIZE = 25;

function parseMode(raw: string | undefined): DispatchQueueMode {
  return raw === 'pending' || raw === 'in_progress' ? raw : 'all';
}

interface PageProps {
  searchParams: Promise<{ mode?: string; page?: string }>;
}

export default async function ExecDispatchPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/dispatch');

  const user = session.user as { id: string; role?: string };
  if (user.role === 'captain') redirect('/captain/dispatch');
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const params = await searchParams;
  const mode = parseMode(params.mode);
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  // super_admin owns no requests, so an exec-scoped query would always be
  // empty for them. Give them the unscoped view instead — an empty screen
  // reads as "broken" far more often than it reads as "nothing assigned".
  const scope: DispatchQueueScope =
    user.role === 'super_admin'
      ? { kind: 'all' }
      : { kind: 'exec', execUserId: user.id };

  const options = { scope, mode, page, pageSize: PAGE_SIZE };
  const [queue, summary] = await Promise.all([
    loadDispatchQueue(options),
    loadDispatchQueueSummary(options),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 md:max-w-5xl">
        <DispatchQueueView
          rows={queue.rows}
          summary={summary}
          mode={mode}
          basePath="/dispatch"
          page={queue.page}
          pageSize={queue.pageSize}
          totalCount={queue.totalCount}
          subtitle={
            user.role === 'super_admin'
              ? 'Every product still to be shipped, across all executives.'
              : 'Products still to be shipped on your confirmed orders. Support dispatches; this is what is outstanding.'
          }
        />
      </div>
    </main>
  );
}
