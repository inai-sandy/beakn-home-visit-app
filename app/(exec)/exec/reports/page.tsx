import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { groupReportsByCategory, type ReportCategory } from '@/lib/reports/registry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My reports — Beakn',
};

const ICON_BY_CATEGORY: Record<string, string> = {
  sales: 'trending_up',
  team: 'groups',
  geography: 'public',
  operational: 'monitor_heart',
  lifecycle: 'route',
  customer: 'person_pin',
  notifications: 'chat',
  targets: 'flag',
};

// Reports that only make sense at team/global level (per-exec rollups,
// captain rollups, city heatmaps, etc.). Hidden for execs viewing their
// own scope.
const EXEC_HIDDEN_CATEGORIES: ReportCategory[] = ['team', 'geography'];

export default async function ExecReportsLandingPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/exec/reports');
  const role = (session.user as { role?: string }).role;
  // Canonical role string is `sales_executive` per lib/auth/roles.ts —
  // the old `sales_exec` typo redirected every real exec to /login.
  // 2026-06-05 fix: Sandeep reported "Reports are not showing up in the
  // sales executive portal" — root cause.
  if (
    role !== 'sales_executive' &&
    role !== 'captain' &&
    role !== 'super_admin'
  ) {
    redirect('/login');
  }

  const groups = groupReportsByCategory().filter(
    (g) => !EXEC_HIDDEN_CATEGORIES.includes(g.category),
  );
  const totalReports = groups.reduce((s, g) => s + g.reports.length, 0);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Reports
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            My reports
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {totalReports} reports scoped to you. Same numbers as the
            dashboard, drilled down by period.
          </p>
        </div>
        <Link
          href="/exec/reports/graphs"
          className="inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-2 text-sm font-medium hover:bg-accent transition-colors w-fit"
        >
          <Icon name="bar_chart" size="sm" />
          Graphs view
        </Link>
      </header>

      {groups.map((group) => (
        <section key={group.category} aria-label={group.label} className="space-y-3">
          <header className="flex items-baseline justify-between gap-3">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight inline-flex items-center gap-2">
              <Icon
                name={ICON_BY_CATEGORY[group.category] ?? 'analytics'}
                size="sm"
                className="text-muted-foreground"
              />
              {group.label}
            </h2>
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {group.reports.length} report{group.reports.length === 1 ? '' : 's'}
            </p>
          </header>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.reports.map((r) => (
              <li key={r.key} className="h-full">
                <Link
                  href={`/exec/reports/${r.key}`}
                  className="block h-full rounded-2xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <p className="text-sm font-semibold tracking-tight inline-flex items-center gap-1">
                    {r.title}
                    <Icon
                      name="arrow_forward"
                      size="xs"
                      className="text-muted-foreground/60"
                    />
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {r.blurb}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
