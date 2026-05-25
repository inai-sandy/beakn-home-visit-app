import type { Metadata } from 'next';

import { ResourcesView } from '@/components/content/ResourcesView';
import { loadPublishedResourcesGrouped } from '@/lib/content/queries';

// =============================================================================
// HVA-156: /captain/resources — captain read surface for sales enablement
// =============================================================================
//
// Same source of truth as the exec surface (D1 / D4 — broadcast to all
// staff). Both portals call loadPublishedResourcesGrouped and render the
// shared ResourcesView component.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Captain',
};

export default async function CaptainResourcesPage() {
  const groups = await loadPublishedResourcesGrouped();
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sales scripts, pricing, brand assets, training.
        </p>
      </header>
      <ResourcesView groups={groups} />
    </main>
  );
}
