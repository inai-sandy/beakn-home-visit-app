import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { Icon } from '@/components/ui/icon';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { groupReportsByCategory } from '@/lib/reports/registry';

// =============================================================================
// /admin/portal/[captainId]/reports — admin's mirror of /captain/reports
// =============================================================================
//
// Sandeep 2026-06-05: *"Reports are not showing up in ... admin >> City >>
// captains portal."* — this page was a "Coming soon" stub since the
// admin-captain-portal mirror landed. Now renders the same library a
// captain sees, with a small chip showing whose portal admin is in.
//
// The category list is identical across captains (config is global), so
// no team-scope filtering on the catalog itself. The reports themselves
// auto-scope when admin clicks through to /admin/reports/[reportKey]
// with the captain pre-filter (captain dropdown on the report detail
// page lets admin pin to this captain explicitly).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reports — Captain portal',
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

interface PageProps {
  params: Promise<{ captainId: string }>;
}

export default async function AdminPortalReportsPage({ params }: PageProps) {
  const { captainId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/login?next=/admin/portal/${captainId}/reports`);
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  const [captain] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      isActive: users.isActive,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, captainId))
    .limit(1);

  if (!captain || captain.role !== 'captain') notFound();

  const groups = groupReportsByCategory();
  const totalReports = groups.reduce((s, g) => s + g.reports.length, 0);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Captain portal · Reports
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Reports library
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {totalReports} reports — what {captain.fullName ?? 'this captain'} sees in their reports library.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground w-fit">
          <Icon name="badge" size="xs" />
          Viewing as: {captain.fullName ?? '—'}
        </span>
      </header>

      {groups.map((group) => (
        <section
          key={group.category}
          aria-label={group.label}
          className="space-y-3"
        >
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
              {group.reports.length} report
              {group.reports.length === 1 ? '' : 's'}
            </p>
          </header>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.reports.map((r) => (
              <li key={r.key} className="h-full">
                <Link
                  href={`/admin/reports/${r.key}?captain=${captainId}`}
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
