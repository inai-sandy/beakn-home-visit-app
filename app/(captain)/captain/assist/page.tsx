import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AssistListView } from '@/components/assist/AssistListView';
import { loadAssistList } from '@/lib/assist/queries';
import { isAssistStatus, isAssistType } from '@/lib/assist/parse';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assist Requests — Beakn captain',
};

interface PageProps {
  searchParams: Promise<{
    type?: string;
    status?: string;
    q?: string;
    exec?: string;
    page?: string;
  }>;
}

export default async function CaptainAssistListPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/assist');
  const role = (session.user as { role?: string }).role;
  if (role !== 'captain' && role !== 'super_admin') redirect('/login');

  const params = await searchParams;
  const type = isAssistType(params.type) ? params.type : undefined;
  const status = isAssistStatus(params.status) ? params.status : undefined;
  const search = params.q?.trim() ?? '';
  const execFilter = params.exec && params.exec !== 'all' ? params.exec : undefined;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const pageSize = 10;

  const { rows, total } = await loadAssistList({
    callerUserId: session.user.id,
    callerRole: role === 'super_admin' ? 'super_admin' : 'captain',
    type,
    status,
    search: search.length > 0 ? search : undefined,
    execUserId: execFilter,
    page,
    pageSize,
  });

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Assist requests</h1>
        <p className="text-sm text-muted-foreground">
          Material requests from your team's execs. Approve, mark processing /
          dispatched, or reject.
        </p>
      </header>
      <AssistListView
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        basePath="/captain/assist"
        detailPath="/captain/assist"
        showExec={true}
        currentType={type ?? 'all'}
        currentStatus={status ?? 'all'}
        currentSearch={search}
      />
    </main>
  );
}
