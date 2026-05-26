import { asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subDays } from 'date-fns';

import { db } from '@/db/client';
import { leads, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import { loadCalendarEvents } from '@/lib/exec/calendar-queries';
import { getIstDateString } from '@/lib/today/time';

import { CalendarAddTaskFab } from './_components/CalendarAddTaskFab';
import { CalendarClient } from './_components/CalendarClient';

// =============================================================================
// HVA-71 (1C): /calendar — Day / Week / Month
// =============================================================================
//
// Server component. Query string drives the view + anchor date:
//   ?view=day|week|month (default day)
//   ?date=YYYY-MM-DD (default today IST)
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Calendar — Beakn',
};

type ViewMode = 'day' | 'week' | 'month';

function parseView(v: string | undefined): ViewMode {
  if (v === 'week' || v === 'month') return v;
  return 'day';
}

function parseDate(v: string | undefined): string {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return getIstDateString();
}

interface PageProps {
  searchParams: Promise<{ view?: string; date?: string }>;
}

export default async function ExecCalendarPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/calendar');
  const user = session.user as { id: string };

  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseDate(sp.date);
  const anchorDate = parseISO(anchor);

  // Compute range per view.
  let fromIso: string;
  let toIso: string;
  if (view === 'day') {
    fromIso = anchor;
    toIso = anchor;
  } else if (view === 'week') {
    const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 }); // Mon
    fromIso = format(weekStart, 'yyyy-MM-dd');
    toIso = format(addDays(weekStart, 6), 'yyyy-MM-dd');
  } else {
    // month: pull entire month + a few padding days so the grid stays filled
    const mStart = startOfMonth(anchorDate);
    const mEnd = endOfMonth(anchorDate);
    fromIso = format(subDays(mStart, 6), 'yyyy-MM-dd');
    toIso = format(addDays(mEnd, 6), 'yyyy-MM-dd');
    void addMonths; // utility kept available for the client's nav
  }

  // F3 2026-05-26: load AddTaskSheet's linkable data so the calendar FAB
  // can open the same sheet with the current anchor date prefilled.
  const visibleContactIds = await loadExecVisibleContactIds(user.id);
  const [events, linkableRequests, linkableLeads] = await Promise.all([
    loadCalendarEvents(user.id, fromIso, toIso),
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
      })
      .from(visitRequests)
      .where(eq(visitRequests.assignedExecUserId, user.id))
      .orderBy(asc(visitRequests.createdAt))
      .limit(50),
    visibleContactIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string; phone: string }>)
      : db
          .select({ id: leads.id, name: leads.name, phone: leads.phone })
          .from(leads)
          .where(inArray(leads.id, visibleContactIds))
          .orderBy(asc(leads.name))
          .limit(50),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 relative">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your scheduled visits + day-plan tasks across days. Tap an entry
          to open it.
        </p>
      </header>
      <CalendarClient
        view={view}
        anchorIso={anchor}
        events={events.map((e) => ({ ...e, at: e.at.toISOString() }))}
      />
      <CalendarAddTaskFab
        anchorDate={anchor}
        linkableRequests={linkableRequests}
        linkableLeads={linkableLeads}
      />
    </main>
  );
}
