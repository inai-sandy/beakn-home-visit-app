import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  leads,
  salesExecutives,
  statusStages,
  tasks,
  users,
  visitRequests,
} from '@/db/schema';
import { TIMEZONE } from '@/lib/date';

// =============================================================================
// 2026-05-26: captain team calendar
// =============================================================================
//
// Same event shape as `lib/exec/calendar-queries.ts`, but the scope is
// every active exec on the captain's team instead of a single exec.
// Each event carries the assigned exec's name so the calendar UI can
// chip / color by exec.
//
// Dedupe rule from the exec calendar carries forward verbatim — if a
// task exists with `link_request_id = some_request`, the visit event
// for that request is suppressed. The auto-task created by
// `scheduleVisitAction` represents the same appointment; emitting both
// produced the "duplicate event" walk bug we fixed in PR1.
// =============================================================================

export interface CaptainCalendarEvent {
  id: string;
  kind: 'visit' | 'task';
  title: string;
  /** Either visit_scheduled_at (visits) or 09:00 IST of task_date (tasks). */
  at: Date;
  stageCode: string | null;
  href: string;
  /** Assigned exec's full name (or null for orphans). */
  execName: string | null;
  /** Stable seed for client-side color assignment. The userId works because
   *  it is sortable + unique per exec. */
  execUserId: string | null;
}

export async function loadTeamCalendarEvents(
  captainUserId: string,
  fromIso: string,
  toIso: string,
): Promise<CaptainCalendarEvent[]> {
  // Active team roster — same predicate the team page uses.
  const teamRows = await db
    .select({ userId: salesExecutives.userId, fullName: users.fullName })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
      ),
    );
  const execIds = teamRows.map((t) => t.userId);
  if (execIds.length === 0) return [];
  const execNameById = new Map(teamRows.map((t) => [t.userId, t.fullName]));

  const fromDate = new Date(`${fromIso}T00:00:00.000Z`);
  const toDate = new Date(`${toIso}T23:59:59.999Z`);

  const execUser = alias(users, 'event_exec_user');

  const visitRows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      visitScheduledAt: visitRequests.visitScheduledAt,
      stageCode: statusStages.code,
      execUserId: visitRequests.assignedExecUserId,
      execName: execUser.fullName,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .where(
      and(
        inArray(visitRequests.assignedExecUserId, execIds),
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
      execUserId: tasks.execUserId,
      requestCustomerName: visitRequests.customerName,
      leadName: leads.name,
    })
    .from(tasks)
    .leftJoin(visitRequests, eq(visitRequests.id, tasks.linkRequestId))
    .leftJoin(leads, eq(leads.id, tasks.linkLeadId))
    .where(
      and(
        inArray(tasks.execUserId, execIds),
        gte(tasks.taskDate, fromIso),
        lte(tasks.taskDate, toIso),
      ),
    )
    .orderBy(asc(tasks.taskDate));

  // Dedupe — same rule as the exec calendar.
  const taskRequestIds = new Set(
    taskRows
      .map((t) => t.linkRequestId)
      .filter((id): id is string => id !== null),
  );

  const events: CaptainCalendarEvent[] = [
    ...visitRows
      .filter((v) => !taskRequestIds.has(v.id))
      .map<CaptainCalendarEvent>((v) => ({
        id: v.id,
        kind: 'visit',
        title: v.customerName,
        at: v.visitScheduledAt!,
        stageCode: v.stageCode,
        href: `/requests/${v.id}`,
        execName: v.execName ?? null,
        execUserId: v.execUserId,
      })),
    ...taskRows.map<CaptainCalendarEvent>((t) => {
      const linkedName = t.requestCustomerName ?? t.leadName ?? null;
      const title = linkedName
        ? `${linkedName} — ${t.description}`
        : t.description;
      const href = t.linkRequestId
        ? `/requests/${t.linkRequestId}`
        : t.linkLeadId
          ? `/captain/contacts/${t.linkLeadId}`
          : `/captain/team`;
      return {
        id: t.id,
        kind: 'task',
        title,
        at: new Date(`${t.taskDate}T09:00:00+05:30`),
        stageCode: t.status,
        href,
        execName: execNameById.get(t.execUserId) ?? null,
        execUserId: t.execUserId,
      };
    }),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

export { TIMEZONE };
