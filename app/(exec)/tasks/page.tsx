import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { leads, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import {
  DEFAULT_PAGE_SIZE,
  loadTasksTable,
  type TasksTableStatus,
} from '@/lib/tasks/tasks-table';

import { ExecTasksTableShell } from './_components/ExecTasksTableShell';

// =============================================================================
// HVA-201 follow-up (2026-06-05): /tasks — unified table view
// =============================================================================
//
// Sandeep: *"plan the same tasks page for sales executives as well"* →
// Option B (replace accordion with table). The /tasks page now mirrors
// /captain/tasks and /admin/tasks — same shared TasksTableFilters +
// TasksTableView. Exec sees only their own tasks (self-scoped, captain
// + exec dropdowns hidden). Per-row "+" action is preserved:
//
//   - Pending / Postponed → "Move" / "Reschedule" button opens MoveTaskSheet
//   - Completed → "Re-add" button opens AddTaskSheet in clone mode
//
// Filters mirror the captain/admin surface: search (description +
// customer + task type), status (all/pending/postponed/completed),
// from/to date, sort direction, pagination.
//
// Auth: sales_executive + captain + super_admin can view (the role
// gate now matches the canonical strings — the legacy `sales_exec`
// typo bit other surfaces earlier today).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tasks — Beakn',
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

export default async function ExecTasksPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/tasks');

  const user = session.user as { id: string; role?: string };
  if (
    user.role !== 'sales_executive' &&
    user.role !== 'captain' &&
    user.role !== 'super_admin'
  ) {
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
  const pageNum = Number(readString(sp.page) ?? '1');
  const page =
    Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  // Linkable pools mirror /today's loader so the cloned-task sheet has
  // the same suggestions surface (HVA-73 PR 3 visibility set).
  const visibleContactIds = await loadExecVisibleContactIds(user.id);
  const [result, linkableRequests, linkableLeads] = await Promise.all([
    loadTasksTable({
      scope: { kind: 'exec', execUserId: user.id },
      status,
      sortDir,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      from: from || undefined,
      to: to || undefined,
      search: q.length > 0 ? q : undefined,
    }),
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
      })
      .from(visitRequests)
      .where(eq(visitRequests.assignedExecUserId, user.id))
      .orderBy(asc(visitRequests.createdAt))
      .limit(50),
    visibleContactIds.length === 0
      ? Promise.resolve(
          [] as Array<{ id: string; name: string; phone: string }>,
        )
      : db
          .select({ id: leads.id, name: leads.name, phone: leads.phone })
          .from(leads)
          .where(
            and(
              inArray(leads.id, visibleContactIds),
              isNull(leads.convertedToRequestId),
            ),
          )
          .orderBy(asc(leads.createdAt))
          .limit(50),
  ]);

  // Preserve filter state in sort/paginator links.
  const stateParams = new URLSearchParams();
  if (q) stateParams.set('q', q);
  if (status !== 'all') stateParams.set('status', status);
  if (sortDir !== 'desc') stateParams.set('dir', sortDir);
  if (from) stateParams.set('from', from);
  if (to) stateParams.set('to', to);

  return (
    <main className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything open across days, plus history. Move a pending or
          postponed task to a new date with the row action; re-add a completed
          one to clone it forward.
        </p>
      </header>

      <ExecTasksTableShell
        result={result}
        basePath="/tasks"
        searchString={stateParams.toString()}
        status={status}
        sortDir={sortDir}
        q={q}
        from={from}
        to={to}
        linkableRequests={linkableRequests}
        linkableLeads={linkableLeads}
      />
    </main>
  );
}
