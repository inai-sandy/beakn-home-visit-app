import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import {
  loadCityExecs,
  loadCityHeader,
  loadCityOpenRequests,
} from '@/lib/admin/city-drill-queries';
import { loadAdminGlobalMetrics, loadCityCards } from '@/lib/admin/dashboard-queries';
import { getServerSession } from '@/lib/auth-server';
import { getIstDateString } from '@/lib/today/time';
import { cn } from '@/lib/utils';

import {
  formatRupees,
  formatRupeesShort,
} from '@/app/admin/dashboard/_components/format';

// =============================================================================
// HVA-117 follow-up: admin city drill page
// =============================================================================
//
// Sandeep 2026-06-02: "when you tap on any city, it opens the captain
// portal with captain's side navigation. One of the worst things."
//
// This page replaces that escape hatch. It stays inside the admin shell
// (sidebar / topbar) and shows everything an admin needs about a city in
// one place: header, today's pulse, exec roster, open requests. From
// here the admin can click into individual requests (/requests/[id]) or
// jump to the global captain portal explicitly via the "Open in captain
// view" link (still useful, just no longer a confusing default).
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ cityId: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { cityId } = await params;
  const header = await loadCityHeader(cityId);
  return {
    title: header
      ? `${header.cityName} — Beakn admin`
      : 'City — Beakn admin',
  };
}

export default async function AdminCityDrillPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session) {
    const { cityId } = await params;
    redirect(`/login?next=/admin/operations/cities/${cityId}`);
  }
  const user = session.user as { role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const { cityId } = await params;
  const istToday = getIstDateString();

  const [header, execs, openRequests, todayMetrics, cityCards] =
    await Promise.all([
      loadCityHeader(cityId),
      loadCityExecs(cityId, istToday),
      loadCityOpenRequests(cityId),
      loadAdminGlobalMetrics(istToday),
      loadCityCards(istToday),
    ]);

  if (!header) notFound();
  void todayMetrics; // suppress unused — kept for future global-vs-city compare

  // Find this city's snapshot from the dashboard's city cards so we can
  // reuse the same today's-pulse numbers without re-running aggregates.
  const cityToday = cityCards.find((c) => c.cityId === cityId);

  return (
    <main className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Back link */}
      <Link
        href="/admin/dashboard"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="arrow_back" size="xs" />
        Back to dashboard
      </Link>

      {/* Header */}
      <section
        aria-label="City overview"
        className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.07] via-primary/[0.02] to-transparent p-6 sm:p-8"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative space-y-4">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
              City
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                {header.cityName}
              </h1>
              {header.state && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide"
                >
                  {header.state}
                </Badge>
              )}
              {header.isOther && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide border-amber-500/60 text-amber-700 dark:text-amber-300"
                >
                  Catch-all
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 min-w-0">
            <LeadAvatar
              name={header.captain?.fullName ?? header.cityName}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-base font-semibold tracking-tight truncate">
                {header.captain
                  ? header.captain.fullName
                  : 'No captain assigned'}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {header.execCount} exec
                {header.execCount === 1 ? '' : 's'} on the team
                {header.captain?.email && (
                  <>
                    {' · '}
                    <a
                      href={`mailto:${header.captain.email}`}
                      className="hover:text-foreground hover:underline underline-offset-2"
                    >
                      {header.captain.email}
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Today's pulse — pulled from the same loadCityCards aggregate
          the dashboard uses, so numbers stay consistent. */}
      {cityToday && (
        <section
          aria-label="Today's pulse"
          className="grid grid-cols-3 gap-3 sm:gap-4"
        >
          <StatTile
            label="Revenue"
            value={formatRupeesShort(cityToday.collectionsTodayPaise)}
            iconName="payments"
            iconTone="text-emerald-600 dark:text-emerald-300 bg-emerald-500/10"
          />
          <StatTile
            label="Visits"
            value={String(cityToday.visitsToday)}
            iconName="directions_walk"
            iconTone="text-sky-600 dark:text-sky-300 bg-sky-500/10"
          />
          <StatTile
            label="Orders"
            value={String(cityToday.ordersToday)}
            iconName="shopping_bag"
            iconTone="text-violet-600 dark:text-violet-300 bg-violet-500/10"
          />
        </section>
      )}

      {/* 2-col bottom: exec roster + open requests */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_2fr] gap-5">
        {/* Exec roster */}
        <section
          aria-label="Exec roster"
          className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-4"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">
              Team
            </h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {execs.length}
            </p>
          </header>
          {execs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No execs on this team yet.{' '}
              <Link
                href="/admin/settings/organization/executives"
                className="text-primary hover:underline underline-offset-2"
              >
                Add execs
              </Link>
            </p>
          ) : (
            <ul className="space-y-2">
              {execs.map((e) => (
                <li
                  key={e.userId}
                  className="flex items-center gap-3 rounded-2xl border bg-background p-3 min-w-0"
                >
                  <LeadAvatar name={e.fullName} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium truncate',
                        e.isActive ? '' : 'text-muted-foreground line-through',
                      )}
                    >
                      {e.fullName}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {e.tasksToday} task{e.tasksToday === 1 ? '' : 's'} today
                      {!e.isActive && ' · inactive'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Open requests */}
        <section
          aria-label="Open requests"
          className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-4"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">
              Open requests
            </h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {openRequests.length}
              {openRequests.length === 50 && '+'}
            </p>
          </header>
          {openRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open requests in this city right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {openRequests.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/requests/${r.id}`}
                    className="group flex items-start gap-3 rounded-2xl border bg-background p-3 transition-colors hover:bg-accent/40 hover:border-foreground/20"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold tracking-tight min-w-0 truncate">
                          {r.customerName}
                        </p>
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wide shrink-0"
                        >
                          {r.statusStageName}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {r.assignedExecName
                          ? `Assigned to ${r.assignedExecName}`
                          : 'Unassigned'}
                        {r.outstandingPaise > 0 && (
                          <>
                            <span className="mx-1.5">·</span>
                            <span className="text-amber-700 dark:text-amber-300 font-medium">
                              {formatRupees(r.outstandingPaise)} outstanding
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <Icon
                      name="chevron_right"
                      size="sm"
                      className="text-muted-foreground/40 group-hover:text-foreground/70 shrink-0 mt-1"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function StatTile({
  label,
  value,
  iconName,
  iconTone,
}: {
  label: string;
  value: string;
  iconName: string;
  iconTone: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5 shadow-sm">
      <span
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-xl',
          iconTone,
        )}
        aria-hidden
      >
        <Icon name={iconName} size="sm" />
      </span>
      <p className="mt-3 text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-xl sm:text-2xl font-bold tabular-nums tracking-tight truncate">
        {value}
      </p>
    </div>
  );
}
