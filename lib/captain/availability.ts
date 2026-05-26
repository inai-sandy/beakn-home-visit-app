import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  execUnavailabilitySchedules,
  salesExecutives,
} from '@/db/schema';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// PR10 2026-05-26: scheduled-unavailability resolution helper
// =============================================================================
//
// `sales_executives.is_unavailable` is the immediate-toggle flag the
// captain flips from /captain/team/[execId]. The new
// `exec_unavailability_schedules` table holds forward-dated windows.
// "Unavailable today?" = (boolean flag) OR (any schedule row covering
// today IST).
//
// Three call shapes:
//   - resolveExecUnavailableToday(execUserId) — single exec
//   - resolveTeamUnavailableTodaySet(execUserIds) — batch; returns the
//     subset of ids unavailable today (factors both axes)
//   - loadExecUnavailabilitySchedules(execUserId) — full schedule list
//     (for the UI to render)
//
// Date axis is always IST (today's calendar date in Asia/Kolkata).
// Schedules store DATEs in their natural day-only representation so
// they don't drift with server timezone.
// =============================================================================

export interface UnavailabilityScheduleRow {
  id: string;
  execUserId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

export async function resolveExecUnavailableToday(
  execUserId: string,
): Promise<boolean> {
  const today = getIstDateString();
  const [flagRow] = await db
    .select({ flag: salesExecutives.isUnavailable })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, execUserId))
    .limit(1);
  if (flagRow?.flag === true) return true;

  const [scheduleRow] = await db
    .select({ id: execUnavailabilitySchedules.id })
    .from(execUnavailabilitySchedules)
    .where(
      and(
        eq(execUnavailabilitySchedules.execUserId, execUserId),
        lte(execUnavailabilitySchedules.startDate, today),
        gte(execUnavailabilitySchedules.endDate, today),
      ),
    )
    .limit(1);
  return Boolean(scheduleRow);
}

export async function resolveTeamUnavailableTodaySet(
  execUserIds: string[],
): Promise<Set<string>> {
  if (execUserIds.length === 0) return new Set();
  const today = getIstDateString();

  const [flagRows, scheduleRows] = await Promise.all([
    db
      .select({ userId: salesExecutives.userId })
      .from(salesExecutives)
      .where(
        and(
          inArray(salesExecutives.userId, execUserIds),
          eq(salesExecutives.isUnavailable, true),
        ),
      ),
    db
      .select({ execUserId: execUnavailabilitySchedules.execUserId })
      .from(execUnavailabilitySchedules)
      .where(
        and(
          inArray(execUnavailabilitySchedules.execUserId, execUserIds),
          lte(execUnavailabilitySchedules.startDate, today),
          gte(execUnavailabilitySchedules.endDate, today),
        ),
      ),
  ]);

  const out = new Set<string>();
  for (const r of flagRows) out.add(r.userId);
  for (const r of scheduleRows) out.add(r.execUserId);
  return out;
}

export async function loadExecUnavailabilitySchedules(
  execUserId: string,
): Promise<UnavailabilityScheduleRow[]> {
  const today = getIstDateString();
  // Return today + future schedules; expired-past windows are admin
  // history and don't need to surface on the management UI. If a
  // history view ships later, lift this filter.
  const rows = await db
    .select({
      id: execUnavailabilitySchedules.id,
      execUserId: execUnavailabilitySchedules.execUserId,
      startDate: execUnavailabilitySchedules.startDate,
      endDate: execUnavailabilitySchedules.endDate,
      reason: execUnavailabilitySchedules.reason,
      createdByUserId: execUnavailabilitySchedules.createdByUserId,
      createdAt: execUnavailabilitySchedules.createdAt,
    })
    .from(execUnavailabilitySchedules)
    .where(
      and(
        eq(execUnavailabilitySchedules.execUserId, execUserId),
        gte(execUnavailabilitySchedules.endDate, today),
      ),
    )
    .orderBy(asc(execUnavailabilitySchedules.startDate));
  return rows;
}
