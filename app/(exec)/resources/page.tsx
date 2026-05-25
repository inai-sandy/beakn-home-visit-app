import type { Metadata } from 'next';

import { ResourcesView } from '@/components/content/ResourcesView';
import { loadPublishedResourcesGrouped } from '@/lib/content/queries';

// =============================================================================
// HVA-156: /resources — exec read surface for sales enablement material
// =============================================================================
//
// Server-rendered. Same source of truth as the captain surface — every
// published resource is broadcast to all staff (D1 / D4).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Beakn',
};

export default async function ExecResourcesPage() {
  const groups = await loadPublishedResourcesGrouped();
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
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
