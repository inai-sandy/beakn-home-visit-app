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
// /captain/tasks — team-scoped tasks list with sort + filter + pagination
// =============================================================================
//
// Sandeep 2026-06-05: *"All tasks should have a proper sort by date
// filter. This should be both in sales, executive, captain, and admin."*
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tasks — Captain',
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

export default async function CaptainTasksPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/tasks');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
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
  const execId = readString(sp.exec) ?? 'all';
  const pageNum = Number(readString(sp.page) ?? '1');
  const page =
    Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  const result = await loadTasksTable({
    scope: { kind: 'captain', captainUserId: user.id },
    status,
    sortDir,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    from: from || undefined,
    to: to || undefined,
    search: q.length > 0 ? q : undefined,
    execUserId: execId !== 'all' ? execId : undefined,
  });

  // Preserve filter state for sort links + paginator.
  const stateParams = new URLSearchParams();
  if (q) stateParams.set('q', q);
  if (status !== 'all') stateParams.set('status', status);
  if (sortDir !== 'desc') stateParams.set('dir', sortDir);
  if (from) stateParams.set('from', from);
  if (to) stateParams.set('to', to);
  if (execId !== 'all') stateParams.set('exec', execId);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All tasks across your team. Sort by date, filter by status, exec,
          or window. Defaults to newest first.
        </p>
      </header>

      <TasksTableFilters
        status={status}
        sortDir={sortDir}
        q={q}
        from={from}
        to={to}
        captainId="all"
        execId={execId}
        captainFacets={[]}
        execFacets={result.execFacets}
        showCaptainFacet={false}
        basePath="/captain/tasks"
      />

      <TasksTableView
        result={result}
        basePath="/captain/tasks"
        searchString={stateParams.toString()}
        showCaptainColumn={false}
      />
    </main>
  );
}
