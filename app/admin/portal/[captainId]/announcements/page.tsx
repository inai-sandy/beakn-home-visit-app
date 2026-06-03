import type { Metadata } from 'next';

import { AnnouncementsView } from '@/components/content/AnnouncementsView';
import {
  loadActiveAnnouncementCategories,
  loadPublishedAnnouncementsForUser,
  loadTeamAnnouncementAckRates,
} from '@/lib/content/queries';

// Mirror of /captain/announcements scoped to URL captainId. Admin sees
// exactly the announcement list + team ack rates that the captain
// sees. The "I've read this" action is captain-only at the server
// layer; admin tapping it would no-op.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcements — Beakn admin',
};

export default async function AdminPortalAnnouncementsPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };

  const [announcements, categories, ackRates] = await Promise.all([
    loadPublishedAnnouncementsForUser(captainId, 'captain'),
    loadActiveAnnouncementCategories(),
    loadTeamAnnouncementAckRates(captainId),
  ]);

  const ackById = new Map(
    ackRates.map((a) => [a.id, { ackCount: a.ackCount, ackTotal: a.ackTotal }]),
  );
  const enriched = announcements.map((a) => {
    const ack = ackById.get(a.id);
    if (!ack) return a;
    return { ...a, ackCount: ack.ackCount, ackTotal: ack.ackTotal };
  });

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View-only mirror of the captain's announcement queue.
        </p>
      </header>
      <AnnouncementsView
        announcements={enriched}
        categories={categories}
        showAckRates
      />
    </main>
  );
}
