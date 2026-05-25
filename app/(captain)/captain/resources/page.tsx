import type { Metadata } from 'next';

import { ResourcesView } from '@/components/content/ResourcesView';
import {
  loadActiveResourceCategories,
  loadPublishedResources,
} from '@/lib/content/queries';

// =============================================================================
// HVA-156-FIX1: /captain/resources — captain read surface
// =============================================================================
//
// Same source of truth as the exec surface (HVA-156 D1 / D4 — broadcast
// to all staff). Both portals call loadPublishedResources +
// loadActiveResourceCategories and render the shared ResourcesView.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Captain',
};

export default async function CaptainResourcesPage() {
  const [resources, categories] = await Promise.all([
    loadPublishedResources(),
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
