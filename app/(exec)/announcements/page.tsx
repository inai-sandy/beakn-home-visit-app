import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AnnouncementsView } from '@/components/content/AnnouncementsView';
import { getServerSession } from '@/lib/auth-server';
import { loadPublishedAnnouncementsForUser } from '@/lib/content/queries';

// =============================================================================
// HVA-156: /announcements — exec read surface for team broadcasts
// =============================================================================
//
// Server-rendered with per-user `isRead` state joined in. The client
// component fires markAllAnnouncementsReadAction on mount so the
// drawer's unread badge drops on the next nav.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcements — Beakn',
};

export default async function ExecAnnouncementsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/announcements');
  const user = session.user as { id: string };

  const announcements = await loadPublishedAnnouncementsForUser(user.id);
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Announcements
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Broadcasts from admin to the team. Newest first.
        </p>
      </header>
      <AnnouncementsView announcements={announcements} />
    </main>
  );
}
