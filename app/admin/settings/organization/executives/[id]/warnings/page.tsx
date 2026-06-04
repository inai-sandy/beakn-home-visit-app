import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { AdminExecWarningRoster } from '@/components/warnings/AdminExecWarningRoster';
import { FireExecBanner } from '@/components/warnings/FireExecBanner';
import { WarningButtons } from '@/components/warnings/WarningButtons';
import { WarningCountsPill } from '@/components/warnings/WarningCountsPill';
import { WarningHistoryList } from '@/components/warnings/WarningHistoryList';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import {
  loadActiveWarningCounts,
  loadWarningHistory,
} from '@/lib/warnings/queries';
import { eq } from 'drizzle-orm';

// =============================================================================
// /admin/settings/organization/executives/[id]/warnings (HVA-228)
// =============================================================================
//
// Admin drill page for one exec's warnings:
//   - Active counts pill + total summary
//   - FireExecBanner (only when 5/5 hard warnings)
//   - WarningButtons to issue a new soft/hard warning
//   - WarningHistoryList with per-row Revoke (admin only)
//
// Reachable from /admin/targets via the exec-name link in the
// AdminExecWarningRoster table.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Warnings — Beakn admin',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminExecWarningsPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) {
    redirect(
      `/login?next=/admin/settings/organization/executives/${id}/warnings`,
    );
  }
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  // Load the exec + their captain.
  const [exec] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      isActive: users.isActive,
      role: users.role,
      captainId: salesExecutives.captainUserId,
    })
    .from(users)
    .leftJoin(salesExecutives, eq(salesExecutives.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);

  if (!exec) notFound();
  if (exec.role !== 'sales_executive') {
    // Warnings are exec-only for now.
    notFound();
  }

  let captainName: string | null = null;
  if (exec.captainId) {
    const [c] = await db
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, exec.captainId))
      .limit(1);
    captainName = c?.name ?? null;
  }

  const [counts, history] = await Promise.all([
    loadActiveWarningCounts(id),
    loadWarningHistory(id),
  ]);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-5">
      <Link
        href="/admin/targets"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="arrow_back" size="xs" />
        Back to team targets
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Performance warnings
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {exec.fullName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Captain: {captainName ?? '—'} ·{' '}
            {exec.isActive ? 'Active' : (
              <span className="text-rose-700 font-medium">Deactivated</span>
            )}
          </p>
        </div>
        <WarningCountsPill counts={counts} />
      </header>

      {exec.isActive && (
        <FireExecBanner
          execUserId={exec.id}
          execName={exec.fullName ?? 'this exec'}
          hardActive={counts.hardActive}
        />
      )}

      {exec.isActive && (
        <section className="rounded-2xl border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Issue a new warning
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Soft for an initial nudge; Hard for repeat underperformance.
            </p>
          </div>
          <WarningButtons
            execUserId={exec.id}
            execName={exec.fullName ?? 'this exec'}
            captainName={captainName}
            currentHardCount={counts.hardActive}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">
          History ({history.length})
        </h2>
        <WarningHistoryList rows={history} canRevoke={exec.isActive} />
      </section>
    </main>
  );
}

// Quiet the bundler — keeps the import warm in case a future surface
// also wants to embed the roster on this page.
void AdminExecWarningRoster;
