import type { Metadata } from 'next';

import { ResourcesView } from '@/components/content/ResourcesView';
import {
  loadActiveResourceCategories,
  loadPublishedResources,
} from '@/lib/content/queries';

// =============================================================================
// HVA-156-FIX1: /resources — exec read surface for sales enablement material
// =============================================================================
//
// Server-rendered shell, client-side filter + share. Same source of truth
// as the captain surface — every published resource is broadcast to all
// staff (HVA-156 D1 / D4).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Beakn',
};

export default async function ExecResourcesPage() {
  const [resources, categories] = await Promise.all([
    loadPublishedResources(),
    loadActiveResourceCategories(),
  ]);
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
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
