import type { Metadata } from 'next';
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

import { getServerSession } from '@/lib/auth-server';
import { loadTeamCalendarEvents } from '@/lib/captain/calendar-queries';
import { getIstDateString } from '@/lib/today/time';

import { CalendarClient } from '@/app/(exec)/calendar/_components/CalendarClient';

// =============================================================================
// 2026-05-26: /captain/calendar — team-wide visit + task calendar
// =============================================================================
//
// Reuses the exec CalendarClient with a different basePath so URL nav
// stays inside the captain section. Events come from
// `loadTeamCalendarEvents` — every active exec on the captain's team,
// dedupe rule from the exec calendar carried forward.
//
// Each event chip carries the assigned exec name so the captain can
// scan "whose visit is this" without drilling in.
//
// View + anchor date contracts are identical to /calendar:
//   ?view=day|week|month   (default day)
//   ?date=YYYY-MM-DD       (default today IST)
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team Calendar — Captain',
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

export default async function CaptainCalendarPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/captain/calendar');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseDate(sp.date);
  const anchorDate = parseISO(anchor);

  // Match the exec calendar window-derivation rules exactly.
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

  // Super_admin currently has no team to load; show empty.
  const events =
    user.role === 'super_admin'
      ? []
      : await loadTeamCalendarEvents(user.id, fromIso, toIso);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Team Calendar
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every team member&apos;s scheduled visits + day-plan tasks. Tap
          an entry to drill in.
        </p>
      </header>
      <CalendarClient
        view={view}
        anchorIso={anchor}
        basePath="/captain/calendar"
        events={events.map((e) => ({
          id: e.id,
          kind: e.kind,
          title: e.title,
          at: e.at.toISOString(),
          stageCode: e.stageCode,
          href: e.href,
          execName: e.execName,
        }))}
      />
    </main>
  );
}
