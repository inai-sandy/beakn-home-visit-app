import type { Metadata } from 'next';

import { ResourcesView } from '@/components/content/ResourcesView';
import {
  loadActiveResourceCategories,
  loadPublishedResourcesForRole,
} from '@/lib/content/queries';

// Mirror of /captain/resources — every resource the captain role can see.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Beakn admin',
};

export default async function AdminPortalResourcesPage() {
  const [resources, categories] = await Promise.all([
    loadPublishedResourcesForRole('captain'),
    loadActiveResourceCategories(),
  ]);
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View-only mirror of the captain's resources surface.
        </p>
      </header>
      <ResourcesView resources={resources} categories={categories} />
    </main>
  );
}
