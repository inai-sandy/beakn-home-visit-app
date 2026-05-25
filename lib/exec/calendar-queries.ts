import { and, asc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

import { db } from '@/db/client';
import { statusStages, tasks, visitRequests } from '@/db/schema';
import { TIMEZONE } from '@/lib/date';

// =============================================================================
// HVA-71: exec calendar data
// =============================================================================
//
// Day / Week / Month views all query the same shape: visits + tasks for
// the exec, in a date range. Day = single date; Week = 7 days; Month =
// every day in the calendar grid (5–6 weeks for the visible month).
// =============================================================================

export interface CalendarEvent {
  id: string;
  kind: 'visit' | 'task';
  title: string;
  /** Either visit_scheduled_at (visits) or 09:00 IST of task_date (tasks). */
  at: Date;
  stageCode: string | null;
  /** Drives the row link target. */
  href: string;
}

/** All visits + tasks for this exec between fromIso and toIso (inclusive). */
export async function loadCalendarEvents(
  execUserId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarEvent[]> {
  const fromDate = new Date(`${fromIso}T00:00:00.000Z`);
  const toDate = new Date(`${toIso}T23:59:59.999Z`);

  const visitRows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      visitScheduledAt: visitRequests.visitScheduledAt,
      stageCode: statusStages.code,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(
      and(
        eq(visitRequests.assignedExecUserId, execUserId),
        isNull(visitRequests.cancelledAt),
        isNotNull(visitRequests.visitScheduledAt),
        gte(visitRequests.visitScheduledAt, fromDate),
        lte(visitRequests.visitScheduledAt, toDate),
      ),
    )
    .orderBy(asc(visitRequests.visitScheduledAt));

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.description,
      taskDate: tasks.taskDate,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.execUserId, execUserId),
        gte(tasks.taskDate, fromIso),
        lte(tasks.taskDate, toIso),
      ),
    )
    .orderBy(asc(tasks.taskDate));

  const events: CalendarEvent[] = [
    ...visitRows.map<CalendarEvent>((v) => ({
      id: v.id,
      kind: 'visit',
      title: v.customerName,
      at: v.visitScheduledAt!,
      stageCode: v.stageCode,
      href: `/requests/${v.id}`,
    })),
    ...taskRows.map<CalendarEvent>((t) => ({
      id: t.id,
      kind: 'task',
      title: t.title,
      // Anchor tasks at 09:00 IST so they cluster at the start of the day
      // in Day view without the SQL needing a time column on tasks.
      at: new Date(`${t.taskDate}T09:00:00+05:30`),
      stageCode: t.status,
      href: `/today`,
    })),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

export { TIMEZONE };
