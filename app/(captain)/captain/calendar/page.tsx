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

import { CalendarFiltersBar } from './_components/CalendarFiltersBar';

// =============================================================================
// 2026-05-26: /captain/calendar — team-wide visit + task calendar
// =============================================================================
//
// Reuses the exec CalendarClient with a different basePath so URL nav
// stays inside the captain section. Events come from
// `loadTeamCalendarEvents` — every active exec on the captain's team,
// dedupe rule from the exec calendar carried forward.
//
// PR11 2026-05-26: + search input + exec filter alongside the existing
// view (day/week/month) selector. URL contract:
//   ?view=day|week|month   (default day)
//   ?date=YYYY-MM-DD       (default today IST)
//   ?exec=<userId>         (default 'all')
//   ?q=<text>              (default '')
//
// Each event chip carries the assigned exec name so the captain can
// scan "whose visit is this" without drilling in.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team Calendar — Captain',
};

type ViewMode = 'day' | 'week' | 'month';

function parseView(v: string | undefined): ViewMode {
  // 2026-05-26: explicit list includes 'day' — previously fell through
  // to the default which happened to also be 'day'. Hardened so a
  // future default change doesn't reintroduce the silent collapse.
  if (v === 'day' || v === 'week' || v === 'month') return v;
  return 'day';
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
    q?: string;
  }>;
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
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
  const search = (sp.q ?? '').trim();

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
  const { events, team } =
    user.role === 'super_admin'
      ? { events: [], team: [] as Array<{ userId: string; fullName: string }> }
      : await loadTeamCalendarEvents(user.id, fromIso, toIso, {
          execUserId: execFilter,
          search,
        });

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
      <CalendarFiltersBar
        team={team}
        currentExec={execFilter ?? 'all'}
        currentSearch={search}
      />
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
