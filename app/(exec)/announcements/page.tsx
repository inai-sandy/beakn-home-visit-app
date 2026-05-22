import type { Metadata } from 'next';

import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-51 stub: /announcements — team announcements placeholder
// =============================================================================
//
// Reachable from the exec hamburger drawer. HVA-156 will replace this stub
// with real team announcements (admin broadcasts, captain pinned notes).
// =============================================================================

export const metadata: Metadata = {
  title: 'Announcements — Beakn',
};

export default function ExecAnnouncementsStubPage() {
  return (
    <main className="min-h-[60svh] flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-sm">
        <Icon
          name="campaign"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <h2 className="text-lg font-semibold tracking-tight">
          Announcements — coming soon
        </h2>
        <p className="text-sm text-muted-foreground">
          HVA-156 will replace this stub with team announcements.
        </p>
      </div>
    </main>
  );
}
