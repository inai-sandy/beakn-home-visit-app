import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { leads, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  loadExecAllPendingTasks,
  loadExecAllPostponedTasks,
  loadExecCompletedTasksPaginated,
} from '@/lib/exec/tasks-page-queries';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import { parsePage } from '@/lib/pagination';

import { TasksPageView } from './_components/TasksPageView';

// =============================================================================
// HVA-170: /tasks — all open work + history
// =============================================================================
//
// Three-section accordion (Pending / Postponed / Completed). Pending opens
// by default. Each row carries a "+" button that opens AddTaskSheet
// pre-filled via the new cloneFromTask prop (HVA-170 D5).
//
// Auth: sales_executive only (per D11). super_admin escape-hatched at
// the proxy.ts layer.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tasks — Beakn',
};

interface PageProps {
  searchParams: Promise<{ page?: string; from?: string; to?: string }>;
}

export default async function ExecTasksPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/tasks');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const raw = await searchParams;
  const page = parsePage(raw.page);
  const dateFrom = raw.from ?? null;
  const dateTo = raw.to ?? null;

  // Linkable pools mirror /today's loader so the cloned-task sheet has
  // the same suggestions surface (HVA-73 PR 3 visibility set).
  const visibleContactIds = await loadExecVisibleContactIds(user.id);
  const [
    pendingTasks,
    postponedTasks,
    completed,
    linkableRequests,
    linkableLeads,
  ] = await Promise.all([
    loadExecAllPendingTasks(user.id),
    loadExecAllPostponedTasks(user.id),
    loadExecCompletedTasksPaginated(user.id, {
      page,
      dateFrom,
      dateTo,
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

  return (
    <TasksPageView
      pendingTasks={pendingTasks}
      postponedTasks={postponedTasks}
      completedGroupedByDate={completed.groupedByDate}
      completedPagination={completed.pagination}
      currentFilter={{ from: dateFrom, to: dateTo }}
      linkableRequests={linkableRequests}
      linkableLeads={linkableLeads}
    />
  );
}
