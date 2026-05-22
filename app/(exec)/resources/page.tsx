import type { Metadata } from 'next';

import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-51 stub: /resources — sales enablement placeholder
// =============================================================================
//
// Reachable from the exec hamburger drawer. HVA-156 will replace this stub
// with real sales enablement resources (PDFs, brand assets, scripts, etc.).
// =============================================================================

export const metadata: Metadata = {
  title: 'Resources — Beakn',
};

export default function ExecResourcesStubPage() {
  return (
    <main className="min-h-[60svh] flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-sm">
        <Icon
          name="menu_book"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <h2 className="text-lg font-semibold tracking-tight">
          Resources — coming soon
        </h2>
        <p className="text-sm text-muted-foreground">
          HVA-156 will replace this stub with sales enablement resources.
        </p>
      </div>
    </main>
  );
}
