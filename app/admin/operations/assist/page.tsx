import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AssistListView } from '@/components/assist/AssistListView';
import { loadAssistList } from '@/lib/assist/queries';
import { isAssistStatus, isAssistType } from '@/lib/assist/parse';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assist Requests — Beakn admin',
};

interface PageProps {
  searchParams: Promise<{
    type?: string;
    status?: string;
    q?: string;
    exec?: string;
    city?: string;
    page?: string;
  }>;
}

export default async function AdminAssistListPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/operations/assist');
  const role = (session.user as { role?: string }).role;
  if (role !== 'super_admin') redirect('/login');

  const params = await searchParams;
  const type = isAssistType(params.type) ? params.type : undefined;
  const status = isAssistStatus(params.status) ? params.status : undefined;
  const search = params.q?.trim() ?? '';
  const execFilter = params.exec && params.exec !== 'all' ? params.exec : undefined;
  const cityFilter = params.city && params.city !== 'all' ? params.city : undefined;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;
  const pageSize = 10;

  const { rows, total } = await loadAssistList({
    callerUserId: session.user.id,
    callerRole: 'super_admin',
    type,
    status,
    search: search.length > 0 ? search : undefined,
    execUserId: execFilter,
    cityId: cityFilter,
    page,
    pageSize,
  });

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Assist requests</h1>
        <p className="text-sm text-muted-foreground">
          Org-wide queue. Approve, process, dispatch, or reject any team's
          assist requests.
        </p>
      </header>
      <AssistListView
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        basePath="/admin/operations/assist"
        detailPath="/admin/operations/assist"
        showExec={true}
        currentType={type ?? 'all'}
        currentStatus={status ?? 'all'}
        currentSearch={search}
      />
    </main>
  );
}
