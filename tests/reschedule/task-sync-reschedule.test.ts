import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, tasks } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { rescheduleByExecAction } from '@/lib/reschedule/actions';
import { scheduleVisitAction } from '@/lib/visit-schedule/actions';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// Regression: reschedule re-anchors the linked visit task's day_plan_id
// =============================================================================
//
// lib/reschedule/actions.ts (commonReschedule) used to move only
// tasks.task_date to the new day via a raw update. lib/exec/today's
// day-plan reads join on tasks.day_plan_id (not task_date), so the task
// stayed attached to the OLD day's plan even though task_date advanced —
// the task effectively vanished from the exec's actual working day and
// lingered (invisibly, since the plan for the old day no longer matches
// the date filter used elsewhere) on the stale plan.
//
// The fix (lib/visit-schedule/task-sync.ts reanchorVisitTaskToDate) also
// repoints day_plan_id to a plan for the NEW date, creating one if none
// exists. These tests exercise the real rescheduleByExecAction end-to-end
// so a regression in either the action's wiring or the helper itself is
// caught.
// =============================================================================

// Build a definite future ISO moment `daysFromNow` days out at a fixed
// UTC hour (well clear of IST midnight-boundary edge cases).
function futureIso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(6, 0, 0, 0); // 11:30 IST
  return d.toISOString();
}

function istDateOf(iso: string): string {
  // Matches TIMEZONE formatting used by the app (Asia/Kolkata, +05:30, no DST).
  const d = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

describe('reschedule re-anchors the linked visit task (regression)', () => {
  it('moving the visit to a new day updates task_date AND repoints day_plan_id to the new day\'s plan', async () => {
    const captain = await seedCaptain({ phone: '+919940000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919940000002',
      fullName: 'Exec ReanchorTest',
      password: 'Reanchor#1',
    });

    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ASSIGNED',
    });
    const visitStage = await getStatusStage('VISIT_SCHEDULED');

    const originalAt = futureIso(2);
    const originalDate = istDateOf(originalAt);
    const newAt = futureIso(4);
    const newDate = istDateOf(newAt);
    expect(newDate).not.toBe(originalDate);

    // Pre-create the day plan for the ORIGINAL date so scheduleVisitAction
    // links the auto-created task to it (mirrors a real Start-My-Day flow).
    const [originalPlan] = await db
      .insert(dayPlans)
      .values({ execUserId: exec.id, planDate: originalDate })
      .returning({ id: dayPlans.id });

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const scheduled = await scheduleVisitAction({
      requestId: req.id,
      nextStatusId: visitStage.id,
      visitScheduledAt: originalAt,
    });
    expect(scheduled.ok).toBe(true);

    const [taskBefore] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.linkRequestId, req.id));
    expect(taskBefore).toBeDefined();
    expect(taskBefore!.taskDate).toBe(originalDate);
    expect(taskBefore!.dayPlanId).toBe(originalPlan!.id);

    // No day plan yet exists for the NEW date — the fix must create one.
    const existingNewPlanBefore = await db
      .select()
      .from(dayPlans)
      .where(eq(dayPlans.execUserId, exec.id));
    expect(existingNewPlanBefore.some((p) => p.planDate === newDate)).toBe(false);

    const result = await rescheduleByExecAction({
      requestId: req.id,
      toVisitScheduledAt: newAt,
      reason: 'Customer asked to push the visit out by two days.',
    });
    expect(result.ok).toBe(true);

    const [taskAfter] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskBefore!.id));
    expect(taskAfter).toBeDefined();
    expect(taskAfter!.taskDate).toBe(newDate);
    // The core regression assertion: day_plan_id must have moved off the
    // original day's plan onto a plan dated to the new day.
    expect(taskAfter!.dayPlanId).not.toBe(originalPlan!.id);
    expect(taskAfter!.dayPlanId).not.toBeNull();

    const [newPlan] = await db
      .select()
      .from(dayPlans)
      .where(eq(dayPlans.id, taskAfter!.dayPlanId!));
    expect(newPlan).toBeDefined();
    expect(newPlan!.planDate).toBe(newDate);
    expect(newPlan!.execUserId).toBe(exec.id);
  });
});
