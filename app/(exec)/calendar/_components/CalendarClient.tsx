'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-71 (1C): client calendar — Day / Week / Month + nav
// =============================================================================

type ViewMode = 'day' | 'week' | 'month';

interface CalendarEventDTO {
  id: string;
  /** 'payment' added in PR13 (2026-05-26) for the captain finance
   *  calendar — same event shape, different kind tag for the badge. */
  kind: 'visit' | 'task' | 'payment';
  title: string;
  at: string;
  stageCode: string | null;
  href: string;
  /** 2026-05-26: optional exec-name chip rendered after the title. The
   *  captain calendar uses this to color-tag events by exec; the exec
   *  calendar leaves it undefined (single-owner view). */
  execName?: string | null;
}

interface Props {
  view: ViewMode;
  anchorIso: string;
  events: CalendarEventDTO[];
  /** Base path for nav router.push. Defaults to the exec route
   *  '/calendar'; captain page passes '/captain/calendar'. */
  basePath?: string;
}

export function CalendarClient({
  view,
  anchorIso,
  events,
  basePath = '/calendar',
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const anchor = parseISO(anchorIso);

  function go(nextView: ViewMode, nextDate: Date) {
    const search = new URLSearchParams(params?.toString() ?? '');
    search.set('view', nextView);
    search.set('date', format(nextDate, 'yyyy-MM-dd'));
    router.push(`${basePath}?${search.toString()}`);
  }

  function shiftBy(days: number) {
    go(view, addDays(anchor, days));
  }
  function shiftMonth(months: number) {
    go(view, addMonths(anchor, months));
  }

  const header = useMemo(() => {
    if (view === 'day') return format(anchor, 'EEE, dd MMM yyyy');
    if (view === 'week') {
      const ws = startOfWeek(anchor, { weekStartsOn: 1 });
      return `${format(ws, 'dd MMM')} – ${format(addDays(ws, 6), 'dd MMM yyyy')}`;
    }
    return format(anchor, 'MMMM yyyy');
  }, [anchor, view]);

  // Decode events once into Date objects.
  const parsedEvents = useMemo(
    () =>
      events.map((e) => ({
        ...e,
        atDate: new Date(e.at),
      })),
    [events],
  );

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {(['day', 'week', 'month'] as ViewMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => go(m, anchor)}
            className={cn(
              'px-3 py-1.5 text-xs uppercase tracking-wide rounded-sm transition-colors',
              view === m
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/60',
            )}
            aria-pressed={view === m}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Date header + nav */}
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            view === 'month' ? shiftMonth(-1) : shiftBy(view === 'week' ? -7 : -1)
          }
        >
          <Icon name="chevron_left" size="sm" />
        </Button>
        <button
          type="button"
          onClick={() => go(view, new Date())}
          className="text-sm font-semibold tracking-tight hover:underline"
        >
          {header}
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            view === 'month' ? shiftMonth(1) : shiftBy(view === 'week' ? 7 : 1)
          }
        >
          <Icon name="chevron_right" size="sm" />
        </Button>
      </div>

      {view === 'day' && <DayView anchor={anchor} events={parsedEvents} />}
      {view === 'week' && (
        <WeekView
          anchor={anchor}
          events={parsedEvents}
          onPickDay={(d) => go('day', d)}
        />
      )}
      {view === 'month' && (
        <MonthView
          anchor={anchor}
          events={parsedEvents}
          onPickDay={(d) => go('day', d)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Day view — vertical list grouped by hour-of-day
// -----------------------------------------------------------------------------

function DayView({
  anchor,
  events,
}: {
  anchor: Date;
  events: (CalendarEventDTO & { atDate: Date })[];
}) {
  const todays = events.filter((e) => isSameDay(e.atDate, anchor));
  if (todays.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
        <Icon
          name="event_busy"
          size="lg"
          className="text-muted-foreground/50 mx-auto mb-3"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          Nothing scheduled on this day.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {todays.map((e) => (
        <li
          key={`${e.kind}-${e.id}`}
          className="rounded-2xl border bg-card p-3 shadow-sm"
        >
          <Link
            href={e.href}
            className="flex items-center gap-3"
          >
            <div className="text-xs tabular-nums text-muted-foreground w-12">
              {format(e.atDate, 'HH:mm')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium tracking-tight truncate">
                {e.title}
              </p>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide"
                >
                  {e.kind}
                </Badge>
                {e.stageCode && (
                  <Badge
                    variant="secondary"
                    className="text-[10px]"
                  >
                    {e.stageCode.replaceAll('_', ' ').toLowerCase()}
                  </Badge>
                )}
                {e.execName && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-primary/40 text-primary"
                  >
                    {e.execName}
                  </Badge>
                )}
              </div>
            </div>
            <Icon
              name="chevron_right"
              size="sm"
              className="text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// -----------------------------------------------------------------------------
// Week view — 7-col grid, per-day count
// -----------------------------------------------------------------------------

function WeekView({
  anchor,
  events,
  onPickDay,
}: {
  anchor: Date;
  events: (CalendarEventDTO & { atDate: Date })[];
  onPickDay: (d: Date) => void;
}) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const count = events.filter((e) => isSameDay(e.atDate, d)).length;
        const isToday = isSameDay(d, new Date());
        return (
          <button
            key={d.toISOString()}
            type="button"
            onClick={() => onPickDay(d)}
            className={cn(
              'rounded-xl border bg-card p-2 text-center transition-colors hover:bg-muted/40',
              isToday ? 'border-primary' : '',
            )}
          >
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {format(d, 'EEE')}
            </p>
            <p
              className={cn(
                'text-base font-semibold tracking-tight mt-0.5',
                isToday ? 'text-primary' : '',
              )}
            >
              {format(d, 'd')}
            </p>
            {count > 0 && (
              <p className="text-[11px] mt-1">
                <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 tabular-nums">
                  {count}
                </span>
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Month view — 5-6 week grid with density dots
// -----------------------------------------------------------------------------

function MonthView({
  anchor,
  events,
  onPickDay,
}: {
  anchor: Date;
  events: (CalendarEventDTO & { atDate: Date })[];
  onPickDay: (d: Date) => void;
}) {
  const mStart = startOfMonth(anchor);
  const mEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(mStart, { weekStartsOn: 1 });
  // 6 weeks max guarantees coverage of any month
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // Trim trailing weeks that are entirely outside the month + future month
  const trimmedCells: Date[] = [];
  for (const c of cells) {
    if (c > addDays(mEnd, 7) && trimmedCells.length >= 35) break;
    trimmedCells.push(c);
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <p
            key={i}
            className="text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {trimmedCells.map((d) => {
          const count = events.filter((e) => isSameDay(e.atDate, d)).length;
          const inMonth = isSameMonth(d, anchor);
          const isToday = isSameDay(d, new Date());
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPickDay(d)}
              className={cn(
                'aspect-square rounded-lg border bg-card p-1 flex flex-col items-center justify-center transition-colors hover:bg-muted/40',
                !inMonth ? 'opacity-40' : '',
                isToday ? 'border-primary' : '',
              )}
            >
              <span
                className={cn(
                  'text-xs',
                  isToday ? 'text-primary font-semibold' : '',
                )}
              >
                {format(d, 'd')}
              </span>
              {count > 0 && (
                <span className="mt-0.5 inline-flex items-center gap-0.5">
                  {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                    <span
                      key={i}
                      className="h-1 w-1 rounded-full bg-primary"
                    />
                  ))}
                  {count > 3 && (
                    <span className="text-[8px] tabular-nums text-primary ml-0.5">
                      +{count - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Reference to keep date-fns subDays import alive when used elsewhere
void subDays;
