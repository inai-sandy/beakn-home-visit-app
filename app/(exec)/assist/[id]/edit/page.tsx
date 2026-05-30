import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { AssistForm } from '@/components/assist/AssistForm';
import { BackButton } from '@/components/ui/back-button';
import {
  loadAssistDetail,
  loadLinkableVisitRequestsForExec,
} from '@/lib/assist/queries';

import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Edit assist — Beakn',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ExecAssistEditPage({ params }: PageProps) {
  const session = await getServerSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/assist/${id}/edit`);
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') redirect('/login');

  const detail = await loadAssistDetail({
    assistId: id,
    callerUserId: session.user.id,
    callerRole: 'sales_executive',
  });
  if (!detail) notFound();

  // Captain has acted — edit form is read-only territory.
  if (detail.status !== 'submitted') {
    redirect(`/assist/${id}`);
  }

  // Bootstrap list of the most-recent linkable visit requests for this exec.
  // The combobox uses it for the empty-query suggestion popover; live search
  // hits /api/assist/linkable-customers as the user types.
  const initialSuggestions = await loadLinkableVisitRequestsForExec({
    execUserId: session.user.id,
    limit: 10,
  });

  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-5">
        <BackButton fallback={`/assist/${id}`} variant="ghost" size="sm">
          Back
        </BackButton>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Edit assist</h1>
          <p className="text-sm text-muted-foreground">
            You can change anything until the captain acts on this request.
          </p>
        </header>
        <AssistForm
          mode="edit"
          assistId={id}
          initialCustomerSuggestions={initialSuggestions}
          initial={{
            type: detail.type,
            items: detail.items.map((it) => ({
              productName: it.productName,
              quantity: it.quantity,
            })),
            orderNumber: detail.orderNumber ?? '',
            dispatchByDate: detail.dispatchByDate ?? '',
            priority: detail.priority,
            message: detail.message ?? '',
            linkedVisitRequest: detail.linkedRequest,
          }}
        />
      </div>
    </main>
  );
}
