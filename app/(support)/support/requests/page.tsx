import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SupportInbox } from '@/components/dispatch-requests/SupportInbox';
import { getServerSession } from '@/lib/auth-server';
import { loadSupportRequestInbox } from '@/lib/dispatch-requests/queries';

// =============================================================================
// HVA-342: /support/requests — what the sales team is waiting on
// =============================================================================
//
// The support half of the Assist replacement. Rows are ORDER GROUPS, not
// requests: one exec asking for stock across three customers produces three
// rows here, each shippable on its own.
//
// Sorted by the exec's stated urgency and required-by date — the only reason
// those two fields are collected.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dispatch requests — Beakn support',
  description: 'Material the sales team has asked to be dispatched.',
};

export default async function SupportRequestsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/support/requests');

  const user = session.user as { role?: string };
  if (user.role !== 'support' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const groups = await loadSupportRequestInbox();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 md:max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Dispatch requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the sales team is waiting on. Dispatching here records the
            real shipment against the order.
          </p>
        </header>
        <SupportInbox groups={groups} />
      </div>
    </main>
  );
}
