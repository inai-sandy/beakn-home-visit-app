import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AnnouncementsView } from '@/components/content/AnnouncementsView';
import { getServerSession } from '@/lib/auth-server';
import { loadPublishedAnnouncementsForUser } from '@/lib/content/queries';

// =============================================================================
// HVA-156: /captain/announcements — captain read surface for team broadcasts
// =============================================================================
//
// Same source of truth as the exec surface (D1 / D4). Read-tracking is
// per-user so each captain has their own unread set; the mount-effect
// fires markAllAnnouncementsReadAction and the drawer badge drops on
// next nav.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcements — Captain',
};

export default async function CaptainAnnouncementsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/announcements');
  const user = session.user as { id: string };

  const announcements = await loadPublishedAnnouncementsForUser(user.id);
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
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
