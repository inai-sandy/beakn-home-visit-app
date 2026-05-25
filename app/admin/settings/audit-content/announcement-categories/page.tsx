import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadAllAnnouncementCategoriesForAdmin } from '@/lib/content/queries';

import { AnnouncementCategoriesClient } from './announcement-categories-client';

// =============================================================================
// HVA-156-FIX2: /admin/settings/audit-content/announcement-categories
// =============================================================================
//
// super_admin CRUD for the admin-managed announcement categories list.
// Drives the category dropdown on the announcements admin form and the
// filter dropdown on the exec/captain announcements read surface.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Announcement Categories — Admin',
};

export default async function AdminAnnouncementCategoriesPage() {
  const session = await getServerSession();
  if (!session) {
    redirect(
      '/login?next=/admin/settings/audit-content/announcement-categories',
    );
  }
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const categories = await loadAllAnnouncementCategoriesForAdmin();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Announcement categories
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Categories drive the filter dropdown that captains + executives
            see on their Announcements page. Deactivating a category hides
            it from new posts + the filter, but keeps existing announcements
            attributed.
          </p>
        </header>
        <AnnouncementCategoriesClient categories={categories} />
      </div>
    </main>
  );
}
