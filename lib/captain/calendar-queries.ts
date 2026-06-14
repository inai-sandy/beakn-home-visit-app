import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

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

export interface LoadTeamCalendarEventsOptions {
  /** Restrict events to a single exec. The id is silently dropped if
   *  it isn't on the captain's team — caller can't escalate. */
  execUserId?: string;
  /** Substring search across event title (customer name) +
   *  exec name. Case-insensitive. Empty/whitespace = no filter. */
  search?: string;
}

export async function loadTeamCalendarEvents(
  captainUserId: string,
  fromIso: string,
  toIso: string,
  options: LoadTeamCalendarEventsOptions = {},
): Promise<{
  events: CaptainCalendarEvent[];
  /** Roster so the page can render an exec-filter dropdown. */
  team: Array<{ userId: string; fullName: string }>;
}> {
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
  const fullExecIds = teamRows.map((t) => t.userId);
  if (fullExecIds.length === 0) {
    return { events: [], team: [] };
  }
  const execNameById = new Map(teamRows.map((t) => [t.userId, t.fullName]));

  // Defence-in-depth: drop URL-supplied execUserId that isn't on the
  // captain's team. Empty = no filter (all team execs).
  const filteredExecIds =
    options.execUserId && execNameById.has(options.execUserId)
      ? [options.execUserId]
      : fullExecIds;
  const execIds = filteredExecIds;

  const execUser = alias(users, 'event_exec_user');

  // HVA-292: match visits by IST calendar date, not UTC day bounds.
  const visitIstDate = sql`(${visitRequests.visitScheduledAt} AT TIME ZONE 'Asia/Kolkata')::date`;

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
        gte(visitIstDate, fromIso),
        lte(visitIstDate, toIso),
      ),
    )
    .orderBy(asc(visitRequests.visitScheduledAt));

  // HVA-292 fix: place a postponed task on its postponed-to date (its
  // task_date never moves on postpone). Mirrors the exec calendar fix.
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
        gte(effectiveDate, fromIso),
        lte(effectiveDate, toIso),
      ),
    )
    .orderBy(asc(effectiveDate));

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
      const effDate =
        t.status === 'postponed' && t.postponedToDate
          ? t.postponedToDate
          : t.taskDate;
      return {
        id: t.id,
        kind: 'task',
        title,
        at: new Date(`${effDate}T09:00:00+05:30`),
        stageCode: t.status,
        href,
        execName: execNameById.get(t.execUserId) ?? null,
        execUserId: t.execUserId,
      };
    }),
  ];
  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Client-side search filter on the materialised events — the search
  // is across the joined customer + exec names; doing it post-query in
  // memory keeps the SQL simple and the bulk size is bounded by the
  // date range (day/week/month).
  const needle = options.search?.trim().toLowerCase() ?? '';
  const filteredEvents =
    needle.length === 0
      ? events
      : events.filter((e) => {
          const haystack = [e.title, e.execName ?? ''].join(' ').toLowerCase();
          return haystack.includes(needle);
        });

  return {
    events: filteredEvents,
    team: teamRows,
  };
}

export { TIMEZONE };
