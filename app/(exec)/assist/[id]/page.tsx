import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { AssistDetailView } from '@/components/assist/AssistDetailView';
import { BackButton } from '@/components/ui/back-button';
import { loadAssistDetail } from '@/lib/assist/queries';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assist — Beakn',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ExecAssistDetailPage({ params }: PageProps) {
  const session = await getServerSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/assist/${id}`);
  const role = (session.user as { role?: string }).role;
  if (role !== 'sales_executive' && role !== 'super_admin') redirect('/login');

  const detail = await loadAssistDetail({
    assistId: id,
    callerUserId: session.user.id,
    callerRole: 'sales_executive',
  });
  if (!detail) notFound();

  const editable = detail.status === 'submitted';
  return (
    <main className="min-h-svh bg-background pb-12">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
        <BackButton fallback="/assist" variant="ghost" size="sm">
          Back
        </BackButton>
        <AssistDetailView
          detail={detail}
          canTransition={false}
          editHref={editable ? `/assist/${detail.id}/edit` : null}
        />
      </div>
    </main>
  );
}
