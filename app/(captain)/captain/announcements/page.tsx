import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AnnouncementsView } from '@/components/content/AnnouncementsView';
import { getServerSession } from '@/lib/auth-server';
import {
  loadActiveAnnouncementCategories,
  loadPublishedAnnouncementsForUser,
} from '@/lib/content/queries';

// =============================================================================
// HVA-156-FIX2: /captain/announcements — captain read surface
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcements — Captain',
};

export default async function CaptainAnnouncementsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/announcements');
  const user = session.user as { id: string; role?: string };

  const [announcements, categories] = await Promise.all([
    loadPublishedAnnouncementsForUser(user.id, user.role),
    loadActiveAnnouncementCategories(),
  ]);
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Announcements
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tap "I've read this" once you've reviewed an announcement.
        </p>
      </header>
      <AnnouncementsView
        announcements={announcements}
        categories={categories}
      />
    </main>
  );
}
