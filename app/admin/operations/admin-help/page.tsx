import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadAdminHelpInbox,
  type AdminHelpDateFilter,
} from '@/lib/admin-help/actions';
import { computePageRange, parsePage } from '@/lib/pagination';

import { AdminHelpInboxClient } from './admin-help-client';

// =============================================================================
// HVA-94 + D1/D2 2026-05-26: /admin/operations/admin-help with
// pagination + search + date chips
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin Help Inbox — Admin',
};

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string; dt?: string }>;
}

function parseDateFilter(v: string | undefined): AdminHelpDateFilter {
  if (v === 'today' || v === 'week' || v === 'month') return v;
  return 'all';
}

export default async function AdminHelpInboxPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/operations/admin-help');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const search = (sp.q ?? '').trim();
  const dateFilter = parseDateFilter(sp.dt);

  const { rows, total } = await loadAdminHelpInbox({
    page,
    search,
    dateFilter,
  });
  const pageRange = computePageRange({ page, total });

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Admin Help Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Messages from sales executives that need a reply. Pending appears
            first. Reply once per message — there's no thread.
          </p>
        </header>
        <AdminHelpInboxClient
          messages={rows}
          total={total}
          pageRange={pageRange}
          currentSearch={search}
          currentDateFilter={dateFilter}
        />
      </div>
    </main>
  );
}
