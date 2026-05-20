import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/lists/Pagination';
import { getServerSession } from '@/lib/auth-server';
import {
  fetchTeamContacts,
  loadCaptainTeamExecOptions,
  loadCaptainTeamUserIds,
} from '@/lib/captain/contacts-queries';
import { computePageRange, parsePage } from '@/lib/pagination';

import { CaptainContactsFilterClient } from './_components/CaptainContactsFilterClient';

// =============================================================================
// HVA-73 + HVA-153: /captain/contacts — server-driven search + pagination
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacts — Captain',
};

type TypeFilter = 'all' | 'Customer' | 'Business';

function parseTypeFilter(raw: unknown): TypeFilter {
  if (raw === 'Customer' || raw === 'Business') return raw;
  return 'all';
}

interface PageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    exec?: string;
    page?: string;
  }>;
}

export default async function CaptainContactsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/contacts');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const typeFilter = parseTypeFilter(params.type);
  const execFilter = params.exec && params.exec !== 'all' ? params.exec : undefined;
  const page = parsePage(params.page);

  const teamUserIds =
    user.role === 'captain' ? await loadCaptainTeamUserIds(user.id) : [];

  // Defence-in-depth: if the URL exec filter isn't on the captain's
  // team, drop it rather than 404 — the user-visible result is the
  // unfiltered list, which matches the dropdown's "All execs" state.
  const safeExecFilter =
    execFilter && teamUserIds.includes(execFilter) ? execFilter : undefined;

  const [{ rows, total }, execOptions] = await Promise.all([
    fetchTeamContacts({
      teamUserIds,
      search: q || undefined,
      typeFilter: typeFilter === 'all' ? undefined : typeFilter,
      execFilter: safeExecFilter,
      page,
    }),
    user.role === 'captain'
      ? loadCaptainTeamExecOptions(user.id)
      : Promise.resolve([]),
  ]);

  // Per-type counts (independent of the active type filter so the chip
  // badges stay honest).
  const [customerTotal, businessTotal, allTotal] = await Promise.all([
    typeFilter === 'Customer'
      ? Promise.resolve(total)
      : fetchTeamContacts({
          teamUserIds,
          search: q || undefined,
          typeFilter: 'Customer',
          execFilter: safeExecFilter,
          page: 1,
          pageSize: 1,
        }).then((r) => r.total),
    typeFilter === 'Business'
      ? Promise.resolve(total)
      : fetchTeamContacts({
          teamUserIds,
          search: q || undefined,
          typeFilter: 'Business',
          execFilter: safeExecFilter,
          page: 1,
          pageSize: 1,
        }).then((r) => r.total),
    typeFilter === 'all'
      ? Promise.resolve(total)
      : fetchTeamContacts({
          teamUserIds,
          search: q || undefined,
          execFilter: safeExecFilter,
          page: 1,
          pageSize: 1,
        }).then((r) => r.total),
  ]);

  const range = computePageRange({ total, page });

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total === 0
              ? 'No contacts captured by your team yet.'
              : `${total} contact${total === 1 ? '' : 's'} across your team.`}
          </p>
        </header>

        <CaptainContactsFilterClient
          rows={rows}
          execOptions={execOptions}
          initial={{
            q,
            type: typeFilter,
            exec: safeExecFilter ?? 'all',
          }}
          typeCounts={{
            all: allTotal,
            Customer: customerTotal,
            Business: businessTotal,
          }}
        />

        {range.totalPages > 1 && (
          <Pagination
            pathname="/captain/contacts"
            page={range.page}
            totalPages={range.totalPages}
            from={range.from}
            to={range.to}
            total={range.total}
          />
        )}
      </div>
    </main>
  );
}
