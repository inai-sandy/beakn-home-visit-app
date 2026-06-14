import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { leads, statusStages, tasks, visitRequests } from '@/db/schema';
import { TIMEZONE } from '@/lib/date';

// =============================================================================
// HVA-71 + 2026-05-26 fix: exec calendar data
// =============================================================================
//
// Day / Week / Month views all query the same shape: visits + tasks for
// the exec, in a date range.
//
// F1 fix: task titles join the linked request's customer name (or lead
// name) so the tile shows "Visit: Sandeep Karnati" instead of just the
// internal task description. Falls back to the raw description when no
// link is set (Outlet visits / Stall activities etc.).
//
// F2 fix: task tap now navigates to /requests/<linkRequestId> when the
// task is linked to a request — gives the exec full customer context.
// Lead-linked tasks point at the contact detail page. Standalone tasks
// (no link) fall back to /tasks?date=YYYY-MM-DD so the exec lands on
// the right day's task list.
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

export async function loadCalendarEvents(
  execUserId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarEvent[]> {
  // HVA-292: match visits by their IST calendar date, not UTC day bounds —
  // otherwise a visit within a few hours of IST midnight buckets onto the
  // wrong day.
  const visitIstDate = sql`(${visitRequests.visitScheduledAt} AT TIME ZONE 'Asia/Kolkata')::date`;

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
        gte(visitIstDate, fromIso),
        lte(visitIstDate, toIso),
      ),
    )
    .orderBy(asc(visitRequests.visitScheduledAt));

  // HVA-292 fix: a postponed task keeps its ORIGINAL task_date but carries
  // the new date in postponed_to_date (postponeTaskAction never moves
  // task_date). The calendar must place it on its EFFECTIVE date — the
  // postponed-to date when postponed, else task_date — both for the range
  // filter and the rendered day. Otherwise a postponed task vanishes from
  // the day you moved it to and lingers on the old day.
  const effectiveDate = sql`CASE
    WHEN ${tasks.status} = 'postponed' AND ${tasks.postponedToDate} IS NOT NULL
      THEN ${tasks.postponedToDate}
    ELSE ${tasks.taskDate}
  END`;

  const taskRows = await db
    .select({
      id: tasks.id,
      description: tasks.description,
      taskDate: tasks.taskDate,
      postponedToDate: tasks.postponedToDate,
      status: tasks.status,
      linkRequestId: tasks.linkRequestId,
      linkLeadId: tasks.linkLeadId,
      // F1: pull joined customer names from request + lead so the tile
      // can lead with the customer instead of the raw description.
      requestCustomerName: visitRequests.customerName,
      leadName: leads.name,
    })
    .from(tasks)
    .leftJoin(visitRequests, eq(visitRequests.id, tasks.linkRequestId))
    .leftJoin(leads, eq(leads.id, tasks.linkLeadId))
    .where(
      and(
        eq(tasks.execUserId, execUserId),
        gte(effectiveDate, fromIso),
        lte(effectiveDate, toIso),
      ),
    )
    .orderBy(asc(effectiveDate));

  // 2026-05-26 dedupe fix: scheduleVisitAction writes BOTH a visit_scheduled_at
  // AND an auto-task linked to the same request. Without dedupe, the calendar
  // renders one event per row pair = "duplicate". Suppress the visit event
  // when a task already represents it; the task carries the same href +
  // customer name and is user-editable. Legacy requests with
  // visit_scheduled_at but no linked task still surface via the visit branch.
  const taskRequestIds = new Set(
    taskRows.map((t) => t.linkRequestId).filter((id): id is string => id !== null),
  );

  const events: CalendarEvent[] = [
    ...visitRows
      .filter((v) => !taskRequestIds.has(v.id))
      .map<CalendarEvent>((v) => ({
        id: v.id,
        kind: 'visit',
        title: v.customerName,
        at: v.visitScheduledAt!,
        stageCode: v.stageCode,
        href: `/requests/${v.id}`,
      })),
    ...taskRows.map<CalendarEvent>((t) => {
      const linkedName = t.requestCustomerName ?? t.leadName ?? null;
      const title = linkedName
        ? `${linkedName} — ${t.description}`
        : t.description;
      // Effective day = postponed-to date when postponed, else task_date.
      const effDate =
        t.status === 'postponed' && t.postponedToDate
          ? t.postponedToDate
          : t.taskDate;
      const href = t.linkRequestId
        ? `/requests/${t.linkRequestId}`
        : t.linkLeadId
          ? `/leads/${t.linkLeadId}`
          : `/tasks?date=${effDate}`;
      return {
        id: t.id,
        kind: 'task',
        title,
        // Anchor tasks at 09:00 IST so they cluster at the start of the day
        // in Day view without the SQL needing a time column on tasks.
        at: new Date(`${effDate}T09:00:00+05:30`),
        stageCode: t.status,
        href,
      };
    }),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

export { TIMEZONE };
