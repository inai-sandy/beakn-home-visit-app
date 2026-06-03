import type { Metadata } from 'next';
import {
  addDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';

import { loadTeamCalendarEvents } from '@/lib/captain/calendar-queries';
import { getIstDateString } from '@/lib/today/time';

import { CalendarClient } from '@/app/(exec)/calendar/_components/CalendarClient';
import { CalendarFiltersBar } from '@/app/(captain)/captain/calendar/_components/CalendarFiltersBar';

// Mirror of /captain/calendar scoped to URL captainId. Same data layer,
// same client component. basePath retargets the calendar nav inside
// the admin portal.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team Calendar — Beakn admin',
};

type ViewMode = 'day' | 'week' | 'month';

function parseView(v: string | undefined): ViewMode {
  if (v === 'day' || v === 'week' || v === 'month') return v;
  return 'day';
}

function parseDate(v: string | undefined): string {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return getIstDateString();
}

interface PageProps {
  params: Promise<unknown>;
  searchParams: Promise<{
    view?: string;
    date?: string;
    exec?: string;
    q?: string;
  }>;
}

export default async function AdminPortalCalendarPage({
  params,
  searchParams,
}: PageProps) {
  const { captainId } = (await params) as { captainId: string };
  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseDate(sp.date);
  const anchorDate = parseISO(anchor);
  const execFilter = sp.exec && sp.exec !== 'all' ? sp.exec : undefined;
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

  const { events, team } = await loadTeamCalendarEvents(
    captainId,
    fromIso,
    toIso,
    { execUserId: execFilter, search },
  );

  const basePath = `/admin/portal/${captainId}/calendar`;

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team Calendar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View-only mirror of the captain's team calendar.
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
        basePath={basePath}
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
