import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { NewRequestForm } from '@/components/dispatch-requests/NewRequestForm';
import { BackButton } from '@/components/ui/back-button';
import { getServerSession } from '@/lib/auth-server';
import { loadExecPickList } from '@/lib/dispatch-requests/queries';

// =============================================================================
// HVA-342: /dispatch/new — ask support to dispatch material
// =============================================================================
//
// Replaces /assist/new. The difference that matters is what the exec is shown
// on arrival: the products their own confirmed orders still owe, already
// listed, rather than an empty product field to type into.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Request dispatch — Beakn',
  description: 'Ask support to dispatch products from your orders.',
};

export default async function NewDispatchRequestPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/dispatch/new');

  const user = session.user as { id: string; role?: string };
  // Exec only. A super_admin holds no assigned orders, so the pick list would
  // be empty and the screen would read as broken rather than as inapplicable.
  if (user.role !== 'sales_executive') redirect('/dispatch');

  const orders = await loadExecPickList(user.id);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 md:max-w-5xl">
        <BackButton fallback="/dispatch" />
        <header className="mt-4 mb-6">
          <h1 className="text-xl font-semibold">Request dispatch</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick what you need and how many. Support ships it and the order
            updates itself.
          </p>
        </header>
        <NewRequestForm orders={orders} />
      </div>
    </main>
  );
}
