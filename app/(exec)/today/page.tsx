import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-65: /today placeholder
// =============================================================================
//
// Locked decision #6 of the HVA-65 bundle: strip the HVA-103 assigned-
// requests list out of /today. That list moved to /requests (the new
// exec list page with bucket tabs + search). /today now shows a short
// placeholder pointing the exec at the new surface; HVA-60 will replace
// this with the real Today daily-plan view.
//
// The route is kept (not deleted) so the bottom-nav and sidebar links
// don't 404. proxy.ts already gates /today to sales_executive + the
// super_admin escape hatch — preserved here as defence-in-depth.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Today — Beakn',
  description: 'Your daily plan view is coming soon.',
};

export default async function TodayPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/today');
  }

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  return (
    <main className="min-h-[60svh] flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-sm">
        <Icon
          name="today"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <h2 className="text-lg font-semibold tracking-tight">
          Your daily plan view is coming soon
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage your assigned requests under{' '}
          <span className="text-foreground/80">Requests</span> in the sidebar.
        </p>
      </div>
    </main>
  );
}
