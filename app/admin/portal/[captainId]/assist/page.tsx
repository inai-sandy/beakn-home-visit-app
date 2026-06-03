import type { Metadata } from 'next';

import { AssistListView } from '@/components/assist/AssistListView';
import { loadAssistList } from '@/lib/assist/queries';
import { isAssistStatus, isAssistType } from '@/lib/assist/parse';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// Mirror of /captain/assist scoped to URL captainId via callerUserId.
// AssistListView renders the rows + filters; per-row links retarget
// into the admin portal namespace via basePath/detailPath.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Assist Requests — Beakn admin',
};

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    type?: string;
    status?: string;
    q?: string;
    exec?: string;
    page?: string;
  }>;
}

export default async function AdminPortalAssistPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = (await params) as { captainId: string };
  const sp = await searchParams;
  const type = isAssistType(sp.type) ? sp.type : undefined;
  const status = isAssistStatus(sp.status) ? sp.status : undefined;
  const search = sp.q?.trim() ?? '';
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const page = Number.parseInt(sp.page ?? '1', 10) || 1;
  const pageSize = 10;

  const { rows, total } = await loadAssistList({
    callerUserId: captainId,
    callerRole: 'captain',
    type,
    status,
    search: search.length > 0 ? search : undefined,
    execUserId: execFilter,
    page,
    pageSize,
  });

  const basePath = `/admin/portal/${captainId}/assist`;

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Assist requests</h1>
        <p className="text-sm text-muted-foreground">
          Material requests from this captain's team execs.
        </p>
      </header>
      <ViewOnlyNotice message="Approve / reject / dispatch actions are captain-only." />
      <AssistListView
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        basePath={basePath}
        detailPath={basePath}
        showExec={true}
        currentType={type ?? 'all'}
        currentStatus={status ?? 'all'}
        currentSearch={search}
      />
    </main>
  );
}
