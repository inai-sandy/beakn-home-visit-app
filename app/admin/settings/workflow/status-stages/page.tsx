import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadStatusStagesWithCounts } from '@/lib/admin/status-stages';

import { StatusStagesClient } from './_components/StatusStagesClient';

// =============================================================================
// HVA-222: /admin/settings/workflow/status-stages
// =============================================================================
//
// Sandeep 2026-06-04: *"Admin has to have complete configuration
// control"*. Phase 1 — catalog edits.
//
// What admin can do here:
//   - Rename a stage's label (e.g. "Quotation Given" → "Quotation submitted")
//   - Reorder by changing sequence_number (was UNIQUE, now non-unique
//     so reorder doesn't fight the constraint mid-swap)
//   - Mark a stage active / inactive (engine reads only active stages)
//   - Mark a stage as terminal
//   - Edit the admin-only description
//   - Add a new stage with a fresh UPPER_SNAKE_CASE code
//   - Delete a stage only if zero visit_requests reference it
//
// What admin CANNOT do here:
//   - Rename `code` (it's the stable identifier; lib/status-transition.ts
//     constants + every visit_requests.status_stage_id row depend on it)
//   - Edit allowed transitions (Phase 2 / HVA-223)
//
// Audit trail: every mutation emits `status_stage_changed` with
// before/after JSON. See `actions.ts`.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status stages — Beakn admin',
};

export default async function StatusStagesAdminPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/workflow/status-stages');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const stages = await loadStatusStagesWithCounts();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Settings · Workflow
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Status stages
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            The request lifecycle catalog. Renaming a label here updates every
            dashboard + report. The internal <code className="font-mono">code</code> identifier
            stays fixed.
          </p>
        </header>

        <StatusStagesClient stages={stages} />
      </div>
    </main>
  );
}
