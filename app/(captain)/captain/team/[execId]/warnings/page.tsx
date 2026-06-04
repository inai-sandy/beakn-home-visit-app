import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { WarningCountsPill } from '@/components/warnings/WarningCountsPill';
import { WarningHistoryList } from '@/components/warnings/WarningHistoryList';
import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { canCaptainViewExec } from '@/lib/captain/exec-drill-queries';
import {
  loadActiveWarningCounts,
  loadWarningHistory,
} from '@/lib/warnings/queries';

// =============================================================================
// /captain/team/[execId]/warnings (HVA-228)
// =============================================================================
//
// Captain read-only view of an exec's warning history. Same data the
// admin sees, but no Soft/Hard buttons (admin-only) and no Revoke
// button (revocation is admin-only per the spec). Captain reaches
// this page from the exec drill header.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Warnings — Team',
};

interface PageProps {
  params: Promise<{ execId: string }>;
}

export default async function CaptainExecWarningsPage({ params }: PageProps) {
  const { execId } = await params;
  const session = await getServerSession();
  if (!session) {
    redirect(`/login?next=/captain/team/${execId}/warnings`);
  }
  const sessUser = session.user as { id: string; role?: string };
  if (sessUser.role !== 'captain' && sessUser.role !== 'super_admin') {
    redirect('/login');
  }

  // Captain visibility — exec must be under this captain (or admin can
  // see anyone).
  if (sessUser.role === 'captain') {
    const allowed = await canCaptainViewExec(sessUser.id, execId, false);
    if (!allowed) notFound();
  }

  const [exec] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      isActive: users.isActive,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, execId))
    .limit(1);

  if (!exec || exec.role !== 'sales_executive') notFound();

  // Captain name for context.
  const [salesExecRow] = await db
    .select({ captainId: salesExecutives.captainUserId })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, execId))
    .limit(1);
  let captainName: string | null = null;
  if (salesExecRow?.captainId) {
    const [c] = await db
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, salesExecRow.captainId))
      .limit(1);
    captainName = c?.name ?? null;
  }

  const [counts, history] = await Promise.all([
    loadActiveWarningCounts(execId),
    loadWarningHistory(execId),
  ]);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-5">
      <Link
        href={`/captain/team/${execId}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="arrow_back" size="xs" />
        Back to exec drill
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

      <section className="rounded-2xl border bg-card p-4 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="info" size="xs" />
          Warnings are issued by admin. To request a revocation, contact
          Sandeep directly.
        </span>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">
          History ({history.length})
        </h2>
        <WarningHistoryList rows={history} canRevoke={false} />
      </section>
    </main>
  );
}
