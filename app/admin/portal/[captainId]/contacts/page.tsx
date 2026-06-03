import type { Metadata } from 'next';

import {
  fetchTeamContacts,
  loadCaptainTeamUserIds,
} from '@/lib/captain/contacts-queries';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// MVP mirror of /captain/contacts scoped to URL captainId. Shows the
// captured-contact list across the captain's team. The captain page
// has filter + pagination + edit-from-row; those follow as polish.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacts — Beakn admin',
};

export default async function AdminPortalContactsPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };
  const teamUserIds = await loadCaptainTeamUserIds(captainId);
  const { rows: contacts } = await fetchTeamContacts({
    teamUserIds,
    page: 1,
    pageSize: 50,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Captured by this captain's team — first 50 most recent.
        </p>
      </header>
      <ViewOnlyNotice />
      {contacts.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No contacts captured by this team yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Contacts">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight truncate">
                  {c.name}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {c.phone}
                  {c.firmName ? ` · ${c.firmName}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
