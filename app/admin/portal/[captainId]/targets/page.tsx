import type { Metadata } from 'next';

import { TeamTargetArena } from '@/components/targets/TeamTargetArena';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadMonthlyTargetPaise,
} from '@/lib/exec/target-progress';

// Read-only mirror of /captain/targets, scoped to the URL captainId.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team targets — Beakn admin',
};

export default async function AdminPortalTargetsPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };
  const monthWindow = getCurrentMonthWindow();
  const monthlyTargetPaise = await loadMonthlyTargetPaise();
  const rows = await loadAllExecTargetProgress(monthWindow, monthlyTargetPaise, {
    captainUserId: captainId,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team targets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monthly progress for every sales executive on this captain's team.
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
