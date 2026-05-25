import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subDays } from 'date-fns';

import { getServerSession } from '@/lib/auth-server';
import { loadCalendarEvents } from '@/lib/exec/calendar-queries';
import { getIstDateString } from '@/lib/today/time';

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

  const events = await loadCalendarEvents(user.id, fromIso, toIso);

  // Client component renders the actual UI — keeps the date math + selection
  // state interactive while the data load stays server-side.
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
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
    </main>
  );
}
