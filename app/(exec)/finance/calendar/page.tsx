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
import { loadPaymentCalendarEvents } from '@/lib/captain/finance-queries';
import { getIstDateString } from '@/lib/today/time';

import { CalendarClient } from '@/app/(exec)/calendar/_components/CalendarClient';

// =============================================================================
// PR13 2026-05-27: /finance/calendar — exec self-view of payment calendar
// =============================================================================
//
// Mirrors /captain/collections/calendar — same component, same dedupe,
// same window-totals + grid + inline event list. Scope is locked to
// requests assigned to this exec via forceExecScope.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment Calendar — Beakn',
};

type ViewMode = 'day' | 'week' | 'month';

function parseView(v: string | undefined): ViewMode {
  if (v === 'day' || v === 'week' || v === 'month') return v;
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

export default async function ExecPaymentCalendarPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/finance/calendar');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseDate(sp.date);
  const anchorDate = parseISO(anchor);
  const search = (sp.q ?? '').trim();

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

  const events = await loadPaymentCalendarEvents({
    captainUserId: user.id,
    isSuperAdmin: false,
    forceExecScope: user.id,
    search,
    fromIso,
    toIso,
  });

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
              Every inbound + refund payment on your requests. Tap an
              event to drill into the customer.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/finance">
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

        <CalendarClient
          view={view}
          anchorIso={anchor}
          basePath="/finance/calendar"
          events={events.map((e) => ({
            id: e.id,
            kind: 'payment' as const,
            title:
              e.direction === 'outbound'
                ? `-${formatRupees(e.amountPaise)} — ${e.customerName}`
                : `${formatRupees(e.amountPaise)} — ${e.customerName}`,
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
