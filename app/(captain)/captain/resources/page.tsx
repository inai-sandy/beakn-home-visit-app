import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ResourcesView } from '@/components/content/ResourcesView';
import { getServerSession } from '@/lib/auth-server';
import {
  loadActiveResourceCategories,
  loadPublishedResourcesForRole,
} from '@/lib/content/queries';

// =============================================================================
// HVA-156-FIX2: /captain/resources — captain read surface
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Captain',
};

export default async function CaptainResourcesPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/resources');
  const user = session.user as { id: string; role?: string };

  const [resources, categories] = await Promise.all([
    loadPublishedResourcesForRole(user.role),
    loadActiveResourceCategories(),
  ]);
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tap Open to view a resource or Share to send it to a customer.
        </p>
      </header>
      <ResourcesView resources={resources} categories={categories} />
    </main>
  );
}
