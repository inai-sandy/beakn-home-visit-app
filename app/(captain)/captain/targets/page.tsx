import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { TeamTargetArena } from '@/components/targets/TeamTargetArena';
import { getServerSession } from '@/lib/auth-server';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadMonthlyTargetPaise,
} from '@/lib/exec/target-progress';

// =============================================================================
// /captain/targets — dedicated team targets page
// =============================================================================
//
// Sandeep 2026-06-03: monthly target arena moved off /captain/dashboard
// onto its own page (mirrors the admin move). Scope stays captain-team
// only via the `captainUserId` filter on loadAllExecTargetProgress.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team targets — Captain',
};

export default async function CaptainTargetsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/targets');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') redirect('/login');

  const monthWindow = getCurrentMonthWindow();
  const monthlyTargetPaise = await loadMonthlyTargetPaise();
  const rows = await loadAllExecTargetProgress(monthWindow, monthlyTargetPaise, {
    captainUserId: user.id,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team targets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monthly progress for every sales executive on your team.
        </p>
      </header>

      <TeamTargetArena
        rows={rows}
        window={monthWindow}
        title="Team targets"
      />
    </div>
  );
}
