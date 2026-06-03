import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { groupReportsByCategory } from '@/lib/reports/registry';

// =============================================================================
// /admin/reports — landing page
// =============================================================================
//
// Lists every report from the registry, grouped by category. Each card
// links to /admin/reports/<key>. Once Sprints 2-4 ship, this page
// expands automatically — the registry is the source of truth.
//
// Graphs entry point lives at /admin/reports/graphs and shows the
// chart variants of the same data the table reports render. Linked
// from the top of this page so admin can switch between table and
// chart views.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reports — Beakn admin',
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

export default async function AdminReportsLandingPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/reports');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  const groups = groupReportsByCategory();
  const totalReports = groups.reduce((s, g) => s + g.reports.length, 0);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Reports
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
            Reports library
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every metric in the app rolled up into a sortable, filterable
            table. {totalReports} reports across {groups.length} categories.
            Same calc discipline as the dashboard tiles — net cash, IST
            timezone, attribution by assigned exec.
          </p>
        </div>
        <Link
          href="/admin/reports/graphs"
          className="inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
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
                  href={`/admin/reports/${r.key}`}
                  className="block h-full rounded-2xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-foreground/20"
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
