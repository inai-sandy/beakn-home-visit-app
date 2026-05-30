import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { AssistDetailView } from '@/components/assist/AssistDetailView';
import { BackButton } from '@/components/ui/back-button';
import { loadAssistDetail } from '@/lib/assist/queries';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assist — Beakn captain',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CaptainAssistDetailPage({ params }: PageProps) {
  const session = await getServerSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/captain/assist/${id}`);
  const role = (session.user as { role?: string }).role;
  if (role !== 'captain' && role !== 'super_admin') redirect('/login');

  const detail = await loadAssistDetail({
    assistId: id,
    callerUserId: session.user.id,
    callerRole: role === 'super_admin' ? 'super_admin' : 'captain',
  });
  if (!detail) notFound();

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <BackButton fallback="/captain/assist" variant="ghost" size="sm">
        Back
      </BackButton>
      <AssistDetailView detail={detail} canTransition={true} editHref={null} />
    </main>
  );
}
