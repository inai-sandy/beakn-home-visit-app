import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';

import { MonthlyExecTargetClient } from './monthly-exec-target-client';

// =============================================================================
// /admin/settings/targets/monthly
// =============================================================================
//
// super_admin-only editor for monthly_exec_target_paise. The value is
// the per-exec monthly target in paise; the exec dashboard tracks both
// ORDER_CONFIRMED order value AND inbound revenue against it. Common
// across all execs / all cities (no per-exec override in v1).
//
// Form input is in rupees for readability — the API multiplies by 100
// before persisting.
// =============================================================================

export const dynamic = 'force-dynamic';

export default async function MonthlyExecTargetAdminPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/admin/settings/targets/monthly');
  }
  const user = session.user as { role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const currentPaise = await getConfig('monthly_exec_target_paise');
  const currentRupees = Math.round(currentPaise / 100);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Monthly executive target
          </h1>
          <p className="text-sm text-muted-foreground">
            Common monthly target across all sales executives, all cities.
            Each exec dashboard tracks two parallel meters against this
            value: ORDER_CONFIRMED order value AND inbound revenue collected
            in the IST calendar month.
          </p>
        </header>

        <MonthlyExecTargetClient currentRupees={currentRupees} />
      </div>
    </main>
  );
}
