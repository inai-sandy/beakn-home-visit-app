import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadAllAnnouncementCategoriesForAdmin,
  loadAllAnnouncementsForAdmin,
} from '@/lib/content/queries';

import { AnnouncementsClient } from './announcements-client';

// =============================================================================
// HVA-156: /admin/content/announcements — super_admin CRUD for announcements
// =============================================================================
//
// Announcements are append-only (D8) — no edit modal. Admins can create
// new ones and unpublish existing ones via a toggle. The unpublish path
// drives the same surface as a delete would: the row disappears from
// the read surface but stays in the audit trail.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcements — Admin',
};

export default async function AdminAnnouncementsPage() {
  const session = await getServerSession();
  if (!session)
    redirect('/login?next=/admin/settings/audit-content/announcements');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const [announcements, categories] = await Promise.all([
    loadAllAnnouncementsForAdmin(),
    loadAllAnnouncementCategoriesForAdmin(),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Announcements
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Broadcast to every captain and executive. Announcements cannot
              be edited after creation; unpublish to hide.
            </p>
          </div>
        </header>
        <AnnouncementsClient
          announcements={announcements}
          categories={categories}
        />
      </div>
    </main>
  );
}
