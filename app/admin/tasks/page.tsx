import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { TasksTableFilters } from '@/components/tasks/TasksTableFilters';
import { TasksTableView } from '@/components/tasks/TasksTableView';
import { getServerSession } from '@/lib/auth-server';
import {
  DEFAULT_PAGE_SIZE,
  loadTasksTable,
  type TasksTableStatus,
} from '@/lib/tasks/tasks-table';

// =============================================================================
// /admin/tasks — global tasks list with sort + filter + pagination
// =============================================================================
//
// Sandeep 2026-06-05: *"All tasks should have a proper sort by date
// filter. This should be both in sales, executive, captain, and admin."*
// Cross-team view; supports captain + exec dropdown filters.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tasks — Beakn admin',
};

const VALID_STATUSES: TasksTableStatus[] = [
  'all',
  'pending',
  'postponed',
  'completed',
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readString(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function AdminTasksPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/tasks');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  const sp = await searchParams;
  const statusRaw = readString(sp.status) ?? 'all';
  const status = (VALID_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as TasksTableStatus)
    : 'all';
  const sortDir = readString(sp.dir) === 'asc' ? 'asc' : 'desc';
  const q = readString(sp.q) ?? '';
  const from = readString(sp.from) ?? '';
  const to = readString(sp.to) ?? '';
  const captainId = readString(sp.captain) ?? 'all';
  const execId = readString(sp.exec) ?? 'all';
  const pageNum = Number(readString(sp.page) ?? '1');
  const page =
    Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  const result = await loadTasksTable({
    scope: { kind: 'global' },
    status,
    sortDir,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    from: from || undefined,
    to: to || undefined,
    search: q.length > 0 ? q : undefined,
    captainUserId: captainId !== 'all' ? captainId : undefined,
    execUserId: execId !== 'all' ? execId : undefined,
  });

  const stateParams = new URLSearchParams();
  if (q) stateParams.set('q', q);
  if (status !== 'all') stateParams.set('status', status);
  if (sortDir !== 'desc') stateParams.set('dir', sortDir);
  if (from) stateParams.set('from', from);
  if (to) stateParams.set('to', to);
  if (captainId !== 'all') stateParams.set('captain', captainId);
  if (execId !== 'all') stateParams.set('exec', execId);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">All tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Global tasks list across every team. Filter by captain, exec, or
          status; sort by date asc or desc.
        </p>
      </header>

      <TasksTableFilters
        status={status}
        sortDir={sortDir}
        q={q}
        from={from}
        to={to}
        captainId={captainId}
        execId={execId}
        captainFacets={result.captainFacets}
        execFacets={result.execFacets}
        showCaptainFacet={true}
        basePath="/admin/tasks"
      />

      <TasksTableView
        result={result}
        basePath="/admin/tasks"
        searchString={stateParams.toString()}
        showCaptainColumn={true}
      />
    </main>
  );
}
