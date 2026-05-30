import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AssistForm } from '@/components/assist/AssistForm';
import { BackButton } from '@/components/ui/back-button';
import { loadLinkableVisitRequestsForExec } from '@/lib/assist/queries';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'New assist — Beakn',
};

export default async function ExecAssistNewPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/assist/new');
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') redirect('/login');

  const linkable = await loadLinkableVisitRequestsForExec({
    execUserId: session.user.id,
  });

  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-5">
        <BackButton fallback="/assist" variant="ghost" size="sm">
          Back
        </BackButton>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New assist</h1>
          <p className="text-sm text-muted-foreground">
            Pick a category, add products, and submit. Nothing is mandatory.
          </p>
        </header>
        <AssistForm
          mode="create"
          linkableVisitRequests={linkable}
          initial={{
            type: 'material_request',
            items: [],
            orderNumber: '',
            dispatchByDate: '',
            priority: 'medium',
            message: '',
            linkedVisitRequestId: null,
          }}
        />
      </div>
    </main>
  );
}
