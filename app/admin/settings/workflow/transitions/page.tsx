import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadAllTransitions } from '@/lib/admin/transitions';

import { TransitionsClient } from './_components/TransitionsClient';

// =============================================================================
// HVA-223: /admin/settings/workflow/transitions
// =============================================================================
//
// Phase A. Admin sees every legal transition between stages, with all
// flags rendered as badges. Only `requires_datetime` is editable right
// now (drives the AdvanceStatusButton calendar dialog). Engine
// enforcement of the other flags migrates in HVA-225.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status transitions — Beakn admin',
};

export default async function StatusTransitionsAdminPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/workflow/transitions');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const transitions = await loadAllTransitions();

  const datetimeCount = transitions.filter((t) => t.requiresDatetime).length;

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Settings · Workflow
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Status transitions
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Every legal move between stages. {transitions.length} transitions
            configured · {datetimeCount} require a date+time picker. Toggle the{' '}
            <strong>Date+time</strong> column to make any transition open a
            calendar dialog when an exec advances to that stage.
          </p>
          <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2 max-w-3xl">
            <strong>Phase A note:</strong> the other columns (Kind / Role /
            Reason / Quote / Auto-task / Event) are shown for reference but
            stay enforced from code for now. HVA-225 wires up admin edits
            for those.
          </p>
        </header>

        <TransitionsClient transitions={transitions} />
      </div>
    </main>
  );
}
