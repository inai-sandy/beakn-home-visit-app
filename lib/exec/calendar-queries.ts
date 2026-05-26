import { and, asc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';

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
      description: tasks.description,
      taskDate: tasks.taskDate,
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
    ...taskRows.map<CalendarEvent>((t) => {
      const linkedName = t.requestCustomerName ?? t.leadName ?? null;
      const title = linkedName
        ? `${linkedName} — ${t.description}`
        : t.description;
      const href = t.linkRequestId
        ? `/requests/${t.linkRequestId}`
        : t.linkLeadId
          ? `/leads/${t.linkLeadId}`
          : `/tasks?date=${t.taskDate}`;
      return {
        id: t.id,
        kind: 'task',
        title,
        // Anchor tasks at 09:00 IST so they cluster at the start of the day
        // in Day view without the SQL needing a time column on tasks.
        at: new Date(`${t.taskDate}T09:00:00+05:30`),
        stageCode: t.status,
        href,
      };
    }),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

export { TIMEZONE };
