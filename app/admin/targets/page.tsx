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
// /admin/targets — dedicated team targets page
// =============================================================================
//
// Sandeep 2026-06-03: monthly target arena moved off /admin/dashboard
// onto its own page so the dashboard stays focused on operational
// pulse. Same data + same UI as the dashboard previously had; just a
// dedicated home.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team targets — Beakn admin',
};

export default async function AdminTargetsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/targets');
  const role = (session.user as { role?: string }).role;
  if (role !== 'super_admin') redirect('/login');

  const monthWindow = getCurrentMonthWindow();
  const monthlyTargetPaise = await loadMonthlyTargetPaise();
  const rows = await loadAllExecTargetProgress(monthWindow, monthlyTargetPaise);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team targets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monthly progress for every sales executive across the org.
        </p>
      </header>

      <TeamTargetArena
        rows={rows}
        window={monthWindow}
        title="All executives — monthly targets"
      />
    </main>
  );
}
