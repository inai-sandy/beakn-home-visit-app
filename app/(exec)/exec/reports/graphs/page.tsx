import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { GraphsView } from '@/components/reports/graphs/GraphsView';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { loadGraphsBundle } from '@/lib/reports/graphs';
import { defaultReportRange } from '@/lib/reports/types';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// /exec/reports/graphs — exec-scoped graphs view (HVA-226)
// =============================================================================
//
// Same 6 charts as /admin/reports/graphs, scoped to the exec themself.
// Exec sees only requests where `assigned_exec_user_id` = caller id.
// The "Top execs" chart degrades to a single bar in this scope.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Graphs — My performance',
};

export default async function ExecReportsGraphsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/exec/reports/graphs');
  const user = session.user as { id: string; role?: string };
  if (
    user.role !== 'sales_executive' &&
    user.role !== 'captain' &&
    user.role !== 'super_admin'
  ) {
    redirect('/login');
  }

  const range = defaultReportRange(getIstDateString());
  const bundle = await loadGraphsBundle({
    scope: { kind: 'exec', execUserId: user.id },
    range,
  });

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link
        href="/exec/reports"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="arrow_back" size="xs" />
        Back to reports
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Reports — Graphs
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            My performance
          </h1>
          <p className="text-sm text-muted-foreground">
            Last 30 days — only the requests assigned to you.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5 whitespace-nowrap w-fit">
          Window: {range.fromDate} → {range.toDate}
        </span>
      </header>

      <GraphsView
        bundle={bundle}
        scope={{ kind: 'exec', execUserId: user.id }}
        windowLabel="the last 30 days"
      />
    </main>
  );
}
