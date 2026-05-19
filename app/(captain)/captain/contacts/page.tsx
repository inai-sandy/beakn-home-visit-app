import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  fetchTeamContacts,
  loadCaptainTeamExecOptions,
  loadCaptainTeamUserIds,
} from '@/lib/captain/contacts-queries';

import { CaptainContactsFilterClient } from './_components/CaptainContactsFilterClient';

// =============================================================================
// HVA-73 PR 2: /captain/contacts — team-wide contact-book
// =============================================================================
//
// Lists every leads row captured by an exec on the captain's team.
// Read-only in this ticket — edit lands in PR 3. super_admin sees nothing
// here (no team scoped to them); they can still walk via /exec/leads for
// support. The layout already enforces role at the route boundary.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacts — Captain',
};

export default async function CaptainContactsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/contacts');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  // super_admin has no team; show empty list (route allowed for support
  // visibility, not for browsing). For a real captain, resolve their team.
  const teamUserIds =
    user.role === 'captain'
      ? await loadCaptainTeamUserIds(user.id)
      : [];

  const [rows, execOptions] = await Promise.all([
    fetchTeamContacts(teamUserIds),
    user.role === 'captain'
      ? loadCaptainTeamExecOptions(user.id)
      : Promise.resolve([]),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length === 0
              ? 'No contacts captured by your team yet.'
              : `${rows.length} contact${rows.length === 1 ? '' : 's'} across your team.`}
          </p>
        </header>

        <CaptainContactsFilterClient rows={rows} execOptions={execOptions} />
      </div>
    </main>
  );
}
