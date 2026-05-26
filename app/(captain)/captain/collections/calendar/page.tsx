import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { loadCaptainCities } from '@/lib/captain/cities';
import {
  loadFinanceTeamRoster,
  loadPaymentCalendarEvents,
} from '@/lib/captain/finance-queries';
import { getIstDateString } from '@/lib/today/time';

import { CalendarClient } from '@/app/(exec)/calendar/_components/CalendarClient';

import { FinanceFiltersBar } from '../_components/FinanceFiltersBar';

// =============================================================================
// PR13 2026-05-26: /captain/collections/calendar — payment calendar
// =============================================================================
//
// Each calendar event = one payment row. Title formats the amount and
// customer (e.g. "₹45,000 — Singh"). Outbound (refund) rows render
// with a minus prefix. Tap an event → /requests/[id].
//
// Reuses the existing CalendarClient with a custom basePath and the
// new 'payment' kind tag. Same filters as the main finance page —
// exec / city / search — so the captain can drill in by the same axes.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment Calendar — Captain',
};

type ViewMode = 'day' | 'week' | 'month';

function parseView(v: string | undefined): ViewMode {
  if (v === 'week' || v === 'month') return v;
  return 'month';
}

function parseDate(v: string | undefined): string {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return getIstDateString();
}

interface PageProps {
  searchParams: Promise<{
    view?: string;
    date?: string;
    exec?: string;
    city?: string;
    q?: string;
  }>;
}

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export default async function CaptainPaymentCalendarPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/collections/calendar');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }
  const isAdmin = user.role === 'super_admin';

  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseDate(sp.date);
  const anchorDate = parseISO(anchor);
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const cityFilter = sp.city && sp.city !== 'all' ? sp.city : undefined;
  const search = (sp.q ?? '').trim();

  // Match calendar window rules.
  let fromIso: string;
  let toIso: string;
  if (view === 'day') {
    fromIso = anchor;
    toIso = anchor;
  } else if (view === 'week') {
    const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
    fromIso = format(weekStart, 'yyyy-MM-dd');
    toIso = format(addDays(weekStart, 6), 'yyyy-MM-dd');
  } else {
    const mStart = startOfMonth(anchorDate);
    const mEnd = endOfMonth(anchorDate);
    fromIso = format(subDays(mStart, 6), 'yyyy-MM-dd');
    toIso = format(addDays(mEnd, 6), 'yyyy-MM-dd');
  }

  const [events, team, captainCities] = await Promise.all([
    loadPaymentCalendarEvents({
      captainUserId: user.id,
      isSuperAdmin: isAdmin,
      execFilter,
      cityFilter,
      search,
      fromIso,
      toIso,
    }),
    loadFinanceTeamRoster(user.id, isAdmin),
    isAdmin ? Promise.resolve([]) : loadCaptainCities(user.id),
  ]);

  const cityWhitelist = new Set(captainCities.map((c) => c.id));
  const safeCity =
    cityFilter && (isAdmin || cityWhitelist.has(cityFilter))
      ? cityFilter
      : 'all';
  const execWhitelist = new Set(team.map((t) => t.userId));
  const safeExec =
    execFilter && (isAdmin || execWhitelist.has(execFilter))
      ? execFilter
      : 'all';

  // Aggregate window totals for the headline.
  const inbound = events
    .filter((e) => e.direction === 'inbound')
    .reduce((acc, e) => acc + e.amountPaise, 0);
  const outbound = events
    .filter((e) => e.direction === 'outbound')
    .reduce((acc, e) => acc + e.amountPaise, 0);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        <header className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Payment Calendar
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every inbound + refund payment in your team scope. Tap an
              event to drill into the customer request.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/captain/collections">
              <Icon name="arrow_back" size="xs" />
              Back to Finance
            </Link>
          </Button>
        </header>

        <section
          aria-label="Window totals"
          className="grid grid-cols-2 gap-3"
        >
          <div className="rounded-2xl border bg-emerald-50/70 border-emerald-300/40 dark:bg-emerald-950/20 p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Inbound (window)
            </p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatRupees(inbound)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {events.filter((e) => e.direction === 'inbound').length} payment
              {events.filter((e) => e.direction === 'inbound').length === 1
                ? ''
                : 's'}
            </p>
          </div>
          <div className="rounded-2xl border bg-rose-50/70 border-rose-300/40 dark:bg-rose-950/20 p-4 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Refunds (window)
            </p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatRupees(outbound)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {events.filter((e) => e.direction === 'outbound').length} refund
              {events.filter((e) => e.direction === 'outbound').length === 1
                ? ''
                : 's'}
            </p>
          </div>
        </section>

        {/* Filter bar lives in the calendar shell too — same shape as
            the main finance page so the captain doesn't relearn. */}
        <FinanceFiltersBar
          team={team}
          cities={captainCities}
          currentSection="all"
          currentExec={safeExec}
          currentCity={safeCity}
          currentSearch={search}
        />

        <CalendarClient
          view={view}
          anchorIso={anchor}
          basePath="/captain/collections/calendar"
          events={events.map((e) => ({
            id: e.id,
            kind: 'payment' as const,
            title:
              e.direction === 'outbound'
                ? `-${formatRupees(e.amountPaise)} — ${e.customerName}`
                : `${formatRupees(e.amountPaise)} — ${e.customerName}`,
            // Anchor each payment at 12:00 IST of its payment_date.
            at: new Date(`${e.paymentDateIso}T12:00:00+05:30`).toISOString(),
            stageCode: e.mode,
            href: `/requests/${e.requestId}`,
            execName: e.execName,
          }))}
        />
      </div>
    </main>
  );
}
