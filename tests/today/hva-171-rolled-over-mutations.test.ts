import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, outcomeOptions, tasks } from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { loginByPhone } from '../helpers/auth';
import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';
import { seedTodayDayPlan } from './helpers';

// =============================================================================
// HVA-171 walk-bug fix: Mark-as-Done + siblings work on rolled-over tasks
// =============================================================================
//
// Repro: task enrolled on a past day's plan, rolled over by the 21:31 IST
// cron, surfaced on the /dashboard Pending accordion via loadExecPendingTasks.
// Pre-fix, every mutation server-action (mark-done, undo, postpone) coupled
// to today's dayPlanId via `eq(tasks.dayPlanId, plan.id)`. That predicate
// excluded rolled-over rows whose dayPlanId points to the originating
// day's plan, so the actions returned "Task not found".
//
// Fix: drop the dayPlanId predicate from those four actions. Ownership
// stays via `eq(tasks.execUserId, auth.actor.id)`.
// =============================================================================

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import {
  markTaskDoneAction,
  postponeTaskAction,
  undoMarkDoneAction,
  undoPostponeAction,
} from '@/app/(exec)/today/actions';
import { getFirstPostponeReason } from './helpers';

beforeEach(() => {
  currentCookieHeader = undefined;
});

async function setupExec() {
  await getOrCreateCity('Bangalore');
  const captain = await seedCaptain();
  const exec = await seedExecutive(captain.id, {
    phone: '+919210000001',
    fullName: 'Rolled-over Exec',
  });
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  return { exec };
}

async function seedPastPlanAndRolledTask(execUserId: string) {
  const yesterday = offsetIstDate(getIstDateString(), -1);
  const [pastPlan] = await db
    .insert(dayPlans)
    .values({ execUserId, planDate: yesterday })
    .returning({ id: dayPlans.id });
  const [task] = await db
    .insert(tasks)
    .values({
      execUserId,
      dayPlanId: pastPlan.id,
      taskType: 'Sales pitch',
      description: 'A representative task description.',
      estimatedTime: '30min',
      taskDate: yesterday,
      status: 'pending',
      rolledOverAt: new Date(),
    })
    .returning({ id: tasks.id });
  return { task, pastPlan };
}

describe('HVA-171 — markTaskDoneAction on a rolled-over task', () => {
  it('succeeds on a task whose dayPlanId is NOT today\'s plan id', async () => {
    const { exec } = await setupExec();
    // Today's plan is required by loadOpenDayPlan (closed-day guard);
    // it has a different id than the rolled-over task's plan.
    await seedTodayDayPlan(exec.id);
    const { task, pastPlan } = await seedPastPlanAndRolledTask(exec.id);

    const [chip] = await db
      .select({ id: outcomeOptions.id })
      .from(outcomeOptions)
      .where(eq(outcomeOptions.code, 'quote_sent'))
      .limit(1);

    const result = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: chip.id,
      outcomeNotes: 'Closed it after a follow-up.',
    });
    expect(result.ok).toBe(true);

    const [after] = await db
      .select({
        status: tasks.status,
        outcomeOptionId: tasks.outcomeOptionId,
        dayPlanId: tasks.dayPlanId,
      })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('completed');
    expect(after.outcomeOptionId).toBe(chip.id);
    // task.dayPlanId stays anchored to the past plan — we don't rewrite it.
    expect(after.dayPlanId).toBe(pastPlan.id);
  });

  it('rejects when the actor is a DIFFERENT exec than the task owner', async () => {
    const { exec: ownerExec } = await setupExec();
    await seedTodayDayPlan(ownerExec.id);
    const { task } = await seedPastPlanAndRolledTask(ownerExec.id);

    // Switch session to a different exec on the same captain.
    const captain = await seedCaptain({
      phone: '+919210000099',
      fullName: 'Other Captain',
    });
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919210000002',
      fullName: 'Other Exec',
    });
    await seedTodayDayPlan(otherExec.id);
    const sess = await loginByPhone(otherExec.phone, otherExec.password);
    currentCookieHeader = sess.cookieHeader;

    const [chip] = await db
      .select({ id: outcomeOptions.id })
      .from(outcomeOptions)
      .where(eq(outcomeOptions.code, 'quote_sent'))
      .limit(1);

    const result = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: chip.id,
      outcomeNotes: 'Hijack attempt.',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Task not found');

    // Owner's task remains pending — no cross-exec write.
    const [after] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('pending');
  });
});

describe('HVA-171 — sibling actions on rolled-over tasks', () => {
  it('postponeTaskAction works on a rolled-over task', async () => {
    const { exec } = await setupExec();
    await seedTodayDayPlan(exec.id);
    const { task } = await seedPastPlanAndRolledTask(exec.id);
    const reason = await getFirstPostponeReason();
    const tomorrow = offsetIstDate(getIstDateString(), 1);

    const result = await postponeTaskAction({
      taskId: task.id,
      reasonId: reason.id,
      postponedToDate: tomorrow,
      customerInformed: true,
    });
    expect(result.ok).toBe(true);

    const [after] = await db
      .select({ status: tasks.status, postponedToDate: tasks.postponedToDate })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('postponed');
    expect(after.postponedToDate).toBe(tomorrow);
  });

  it('undoMarkDoneAction reverts a rolled-over task that was just completed', async () => {
    const { exec } = await setupExec();
    await seedTodayDayPlan(exec.id);
    const { task } = await seedPastPlanAndRolledTask(exec.id);
    const [chip] = await db
      .select({ id: outcomeOptions.id })
      .from(outcomeOptions)
      .where(eq(outcomeOptions.code, 'quote_sent'))
      .limit(1);

    await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: chip.id,
      outcomeNotes: 'done',
    });
    const undo = await undoMarkDoneAction(task.id);
    expect(undo.ok).toBe(true);

    const [after] = await db
      .select({ status: tasks.status, completedAt: tasks.completedAt })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('pending');
    expect(after.completedAt).toBeNull();
  });

  it('undoPostponeAction reverts a rolled-over task that was just postponed', async () => {
    const { exec } = await setupExec();
    await seedTodayDayPlan(exec.id);
    const { task } = await seedPastPlanAndRolledTask(exec.id);
    const reason = await getFirstPostponeReason();
    const tomorrow = offsetIstDate(getIstDateString(), 1);

    await postponeTaskAction({
      taskId: task.id,
      reasonId: reason.id,
      postponedToDate: tomorrow,
      customerInformed: true,
    });
    const undo = await undoPostponeAction(task.id);
    expect(undo.ok).toBe(true);

    const [after] = await db
      .select({
        status: tasks.status,
        postponedToDate: tasks.postponedToDate,
        postponeReasonId: tasks.postponeReasonId,
      })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('pending');
    expect(after.postponedToDate).toBeNull();
    expect(after.postponeReasonId).toBeNull();
  });
});
