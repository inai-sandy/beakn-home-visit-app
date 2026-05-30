import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AnnouncementsView } from '@/components/content/AnnouncementsView';
import { getServerSession } from '@/lib/auth-server';
import {
  loadActiveAnnouncementCategories,
  loadPublishedAnnouncementsForUser,
  loadTeamAnnouncementAckRates,
} from '@/lib/content/queries';

// =============================================================================
// HVA-156-FIX2 + HVA-120: /captain/announcements — captain read + manager view
// =============================================================================
//
// Captain sees announcements as a recipient ("I've read this" button) AND
// as a team manager (ack rates "X/Y acknowledged" inline on each row).
// We fetch both the per-user list (drives isAcknowledged) and the team
// ack-rate list (drives ackCount/ackTotal), then merge.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcements — Captain',
};

export default async function CaptainAnnouncementsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/announcements');
  const user = session.user as { id: string; role?: string };

  const [announcements, categories, ackRates] = await Promise.all([
    loadPublishedAnnouncementsForUser(user.id, user.role),
    loadActiveAnnouncementCategories(),
    loadTeamAnnouncementAckRates(user.id),
  ]);

  // Merge ack rates into the user's announcement list by id.
  const ackById = new Map(
    ackRates.map((a) => [
      a.id,
      { ackCount: a.ackCount, ackTotal: a.ackTotal },
    ]),
  );
  const enriched = announcements.map((a) => {
    const ack = ackById.get(a.id);
    if (!ack) return a;
    return { ...a, ackCount: ack.ackCount, ackTotal: ack.ackTotal };
  });

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Announcements
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tap "I've read this" once you've reviewed an announcement.
          Acknowledgment rates show how many of your team have read each one.
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
