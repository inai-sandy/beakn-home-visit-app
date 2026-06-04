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
// /captain/reports/graphs — captain-scoped graphs view (HVA-226)
// =============================================================================
//
// Same 6 charts as /admin/reports/graphs, but the bundle loader is
// scoped to the captain's team. Captain sees only the requests whose
// `visit_requests.assigned_exec_user_id` belongs to one of their execs.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Graphs — Captain',
};

export default async function CaptainReportsGraphsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/reports/graphs');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const range = defaultReportRange(getIstDateString());
  const bundle = await loadGraphsBundle({
    scope: { kind: 'captain', captainUserId: user.id },
    range,
  });

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link
        href="/captain/reports"
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
            Team performance
          </h1>
          <p className="text-sm text-muted-foreground">
            Last 30 days — your team only.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground bg-muted/40 rounded-md px-2 py-1.5 whitespace-nowrap w-fit">
          Window: {range.fromDate} → {range.toDate}
        </span>
      </header>

      <GraphsView
        bundle={bundle}
        scope={{ kind: 'captain', captainUserId: user.id }}
        windowLabel="the last 30 days"
      />
    </main>
  );
}
