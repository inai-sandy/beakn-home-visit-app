import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DateRangePicker } from '@/app/(captain)/captain/dashboard/_components/DateRangePicker';
import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import {
  loadCityExecs,
  loadCityHeader,
  loadCityMetricsForWindow,
  loadCityOpenRequests,
} from '@/lib/admin/city-drill-queries';
import { getServerSession } from '@/lib/auth-server';
import {
  resolveDateFilter,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { METRIC_DEFINITIONS } from '@/lib/metrics/registry';
import { getIstDateString } from '@/lib/today/time';
import { cn } from '@/lib/utils';

import {
  formatRupees,
  formatRupeesShort,
} from '@/app/admin/dashboard/_components/format';

// =============================================================================
// Admin city drill — admin shell, date-filtered metrics
// =============================================================================
//
// Sandeep 2026-06-03: this is the city ops surface. Stays in the admin
// shell (no captain-portal escape — admins aren't captains). Metrics
// are date-filtered via the same calendar picker the captain dashboard
// uses, defaulting to TODAY single-date. URL state: ?date=YYYY-MM-DD or
// ?from=YYYY-MM-DD&to=YYYY-MM-DD. Tap a city tile on /admin/dashboard
// to open here in a new tab.
//
// What's date-filtered:
//   - Period metrics (visits / collections / orders / quotations /
//     new requests / conversion%) for the window
//
// What's snapshot (not date-filtered):
//   - City header + captain info
//   - Team roster (current execs)
//   - Open requests (currently-open snapshot, newest first capped at 50)
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ cityId: string }>;
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/u;

function parseDateFilter(sp: {
  date?: string;
  from?: string;
  to?: string;
}): DateFilter {
  if (sp.from && sp.to && ISO_RE.test(sp.from) && ISO_RE.test(sp.to)) {
    // Normalise so from <= to.
    return sp.from <= sp.to
      ? { mode: 'range', from: sp.from, to: sp.to }
      : { mode: 'range', from: sp.to, to: sp.from };
  }
  if (sp.date && ISO_RE.test(sp.date)) {
    return { mode: 'single', date: sp.date };
  }
  // Default to today single-date.
  return { mode: 'single', date: getIstDateString() };
}

function windowLabel(filter: DateFilter): string {
  if (filter.mode === 'single') {
    return formatHumanDate(filter.date);
  }
  return `${formatHumanDate(filter.from)} – ${formatHumanDate(filter.to)}`;
}

function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC', // Avoids one-day-off when running on UTC server
  });
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

export default async function AdminCityDrillPage({
  params,
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) {
    const { cityId } = await params;
    redirect(`/login?next=/admin/operations/cities/${cityId}`);
  }
  const user = session.user as { role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const { cityId } = await params;
  const sp = await searchParams;
  const filter = parseDateFilter(sp);
  const resolved = resolveDateFilter(filter);
  const istToday = getIstDateString();

  const [header, execs, openRequests, windowMetrics] = await Promise.all([
    loadCityHeader(cityId),
    loadCityExecs(cityId, istToday),
    loadCityOpenRequests(cityId),
    loadCityMetricsForWindow(
      cityId,
      resolved.target.from,
      resolved.target.to,
    ),
  ]);

  if (!header) notFound();

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Top breadcrumb / back nav */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="arrow_back" size="xs" />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
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

      {/* Page title + date picker on the same row */}
      <header className="mb-5 sm:mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            City
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
            {header.cityName}
          </h1>
        </div>
        <DateRangePicker
          filter={filter}
          pathname={`/admin/operations/cities/${cityId}`}
        />
      </header>

      <p className="text-[11px] text-muted-foreground tabular-nums mb-5">
        Metrics for{' '}
        <span className="font-semibold text-foreground">
          {windowLabel(filter)}
        </span>
        {' · '}
        {resolved.daysInTarget} day
        {resolved.daysInTarget === 1 ? '' : 's'}
      </p>

      {/* Sub-sidebar layout: 340px context column @ lg+; 1-col stack below. */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-5 lg:gap-6">
        {/* ============================================================
            LEFT — sticky sub-sidebar with city context.
        ============================================================ */}
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
          {/* Captain identity card */}
          <section
            aria-label="Captain"
            className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/[0.07] via-primary/[0.02] to-transparent p-5"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/10 blur-3xl"
            />
            <div className="relative space-y-3">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
                Captain
              </p>
              <div className="flex items-start gap-3 min-w-0">
                <LeadAvatar
                  name={header.captain?.fullName ?? header.cityName}
                  aria-hidden
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-base font-semibold tracking-tight truncate">
                    {header.captain
                      ? header.captain.fullName
                      : 'No captain assigned'}
                  </p>
                  {header.captain?.email && (
                    <a
                      href={`mailto:${header.captain.email}`}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2 truncate block"
                    >
                      {header.captain.email}
                    </a>
                  )}
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {header.execCount} exec
                    {header.execCount === 1 ? '' : 's'} on the team
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Period metrics — date-filtered */}
          <section aria-label="Period metrics" className="space-y-2">
            <h2 className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold px-1">
              Window metrics
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <CompactStat
                label="Revenue"
                value={formatRupeesShort(windowMetrics.collectionsPaise)}
                iconName="payments"
                iconTone="text-emerald-600 dark:text-emerald-300 bg-emerald-500/10"
                explainer={METRIC_DEFINITIONS.revenue.explainer}
              />
              <CompactStat
                label="Visits"
                value={String(windowMetrics.visitsCount)}
                iconName="directions_walk"
                iconTone="text-sky-600 dark:text-sky-300 bg-sky-500/10"
                explainer={METRIC_DEFINITIONS.visits.explainer}
              />
              <CompactStat
                label="Orders"
                value={String(windowMetrics.ordersCount)}
                iconName="shopping_bag"
                iconTone="text-violet-600 dark:text-violet-300 bg-violet-500/10"
                explainer={METRIC_DEFINITIONS.orders_count.explainer}
              />
              <CompactStat
                label="Quotations"
                value={String(windowMetrics.quotationsCount)}
                iconName="request_quote"
                iconTone="text-amber-600 dark:text-amber-300 bg-amber-500/10"
                explainer={METRIC_DEFINITIONS.quotations_count.explainer}
              />
              <CompactStat
                label="New reqs"
                value={String(windowMetrics.newRequestsCount)}
                iconName="inbox"
                iconTone="text-rose-600 dark:text-rose-300 bg-rose-500/10"
                explainer={METRIC_DEFINITIONS.new_requests.explainer}
              />
              <CompactStat
                label="Conv."
                value={
                  windowMetrics.conversionPct === null
                    ? '—'
                    : `${windowMetrics.conversionPct}%`
                }
                iconName="donut_small"
                iconTone="text-indigo-600 dark:text-indigo-300 bg-indigo-500/10"
                explainer={METRIC_DEFINITIONS.conversion_pct.explainer}
              />
            </div>
          </section>

          {/* Quick actions — admin-only, no captain-portal jumps */}
          <section aria-label="Quick actions" className="space-y-2">
            <h2 className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold px-1">
              Quick actions
            </h2>
            <div className="rounded-2xl border bg-card divide-y divide-border/60">
              <ActionLink
                href="/admin/settings/organization/cities"
                icon="edit_location"
                label="Edit city settings"
                description="Captain assignment, routing email"
              />
              <ActionLink
                href="/admin/settings/organization/captains"
                icon="shield_person"
                label="Manage captains"
              />
              <ActionLink
                href="/admin/settings/organization/executives"
                icon="badge"
                label="Manage executives"
              />
            </div>
          </section>
        </aside>

        {/* ============================================================
            RIGHT — main column with the scrollable lists.
        ============================================================ */}
        <div className="space-y-5 min-w-0">
          {/* Open requests */}
          <section
            aria-label="Open requests"
            className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-4"
          >
            <header className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base sm:text-lg font-semibold tracking-tight">
                  Open requests
                </h2>
                <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                  {openRequests.length}
                  {openRequests.length === 50 && '+'} currently active in this
                  city
                </p>
              </div>
            </header>
            {openRequests.length === 0 ? (
              <EmptyState
                icon="inbox"
                message="No open requests in this city right now."
              />
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

          {/* Team roster — current snapshot, not date-filtered */}
          <section
            aria-label="Team roster"
            className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm space-y-4"
          >
            <header className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base sm:text-lg font-semibold tracking-tight">
                  Team
                </h2>
                <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                  {execs.length} sales executive
                  {execs.length === 1 ? '' : 's'} · today's task count
                </p>
              </div>
            </header>
            {execs.length === 0 ? (
              <EmptyState
                icon="group_off"
                message="No execs on this team yet."
                ctaHref="/admin/settings/organization/executives"
                ctaLabel="Add execs"
              />
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                          e.isActive
                            ? ''
                            : 'text-muted-foreground line-through',
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
        </div>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Sub-sidebar building blocks
// -----------------------------------------------------------------------------

function CompactStat({
  label,
  value,
  iconName,
  iconTone,
  explainer,
}: {
  label: string;
  value: string;
  iconName: string;
  iconTone: string;
  explainer?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg',
            iconTone,
          )}
          aria-hidden
        >
          <Icon name={iconName} size="xs" />
        </span>
        {explainer ? <InfoTooltip iconOnly>{explainer}</InfoTooltip> : null}
      </div>
      <div>
        <p className="text-[9px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-bold tabular-nums tracking-tight truncate">
          {value}
        </p>
      </div>
    </div>
  );
}

function ActionLink({
  href,
  icon,
  label,
  description,
}: {
  href: string;
  icon: string;
  label: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-foreground group-hover:bg-accent/60 transition-colors shrink-0">
        <Icon name={icon} size="xs" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{label}</p>
        {description && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {description}
          </p>
        )}
      </div>
      <Icon
        name="chevron_right"
        size="xs"
        className="text-muted-foreground/40 group-hover:text-foreground/70 shrink-0"
      />
    </Link>
  );
}

function EmptyState({
  icon,
  message,
  ctaHref,
  ctaLabel,
}: {
  icon: string;
  message: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} size="sm" />
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="text-xs text-primary hover:underline underline-offset-2 mt-1"
        >
          {ctaLabel} →
        </Link>
      )}
    </div>
  );
}
