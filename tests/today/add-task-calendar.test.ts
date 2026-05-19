import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addTaskAction,
  markTaskDoneAction,
} from '@/app/(exec)/today/actions';
import { db } from '@/db/client';
import { dayPlans, outcomeOptions, tasks } from '@/db/schema';
import { getIstDateString } from '@/lib/today/time';

import { loginByPhone } from '../helpers/auth';
import {
  seedCaptain,
  seedExecutive,
} from '../helpers/db';
import { seedTodayDayPlan, seedTask } from './helpers';

// =============================================================================
// Task calendar picker — addTaskAction with taskDate + markTaskDone guard
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

beforeEach(() => {
  currentCookieHeader = undefined;
});

function ymdAddDays(istDate: string, deltaDays: number): string {
  const [y, m, d] = istDate.split('-').map((s) => Number(s));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + deltaDays);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function setupExecWithTodayPlan() {
  const captain = await seedCaptain();
  const exec = await seedExecutive(captain.id);
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  const plan = await seedTodayDayPlan(exec.id);
  return { exec, plan };
}

describe('addTaskAction — taskDate validation', () => {
  it('defaults to today when taskDate is omitted (back-compat)', async () => {
    const { exec, plan } = await setupExecWithTodayPlan();
    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'A task with no date supplied',
      estimatedTime: '30min',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, res.data!.taskId))
      .limit(1);
    expect(row.taskDate).toBe(getIstDateString());
    expect(row.dayPlanId).toBe(plan.id);
    expect(row.execUserId).toBe(exec.id);
  });

  it('rejects a past date', async () => {
    await setupExecWithTodayPlan();
    const yesterday = ymdAddDays(getIstDateString(), -1);
    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'A task scheduled in the past',
      estimatedTime: '30min',
      taskDate: yesterday,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/past/i);
  });

  it('rejects a date beyond the 30-day window', async () => {
    await setupExecWithTodayPlan();
    const tooFar = ymdAddDays(getIstDateString(), 31);
    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'A task way out in the future',
      estimatedTime: '30min',
      taskDate: tooFar,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/30 days/i);
  });
});

describe('addTaskAction — today linkage', () => {
  it('links to today\'s day_plan when taskDate = today', async () => {
    const { exec, plan } = await setupExecWithTodayPlan();
    const today = getIstDateString();
    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Today-dated task wires to today plan',
      estimatedTime: '30min',
      taskDate: today,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, res.data!.taskId))
      .limit(1);
    expect(row.dayPlanId).toBe(plan.id);
    expect(row.taskDate).toBe(today);
    expect(row.execUserId).toBe(exec.id);
  });
});

describe('addTaskAction — future date auto-creates the day plan', () => {
  it('inserts a new dayPlans row when one doesn\'t exist for the future date', async () => {
    const { exec } = await setupExecWithTodayPlan();
    const tomorrow = ymdAddDays(getIstDateString(), 1);

    // Sanity: no future plan yet.
    const before = await db
      .select({ id: dayPlans.id })
      .from(dayPlans)
      .where(
        and(eq(dayPlans.execUserId, exec.id), eq(dayPlans.planDate, tomorrow)),
      );
    expect(before).toHaveLength(0);

    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'A task scheduled for tomorrow',
      estimatedTime: '30min',
      taskDate: tomorrow,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [futurePlan] = await db
      .select()
      .from(dayPlans)
      .where(
        and(eq(dayPlans.execUserId, exec.id), eq(dayPlans.planDate, tomorrow)),
      )
      .limit(1);
    expect(futurePlan).toBeTruthy();
    expect(futurePlan.closedAt).toBeNull();

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, res.data!.taskId))
      .limit(1);
    expect(task.dayPlanId).toBe(futurePlan.id);
    expect(task.taskDate).toBe(tomorrow);
  });

  it('reuses an existing future dayPlans row instead of creating a duplicate', async () => {
    const { exec } = await setupExecWithTodayPlan();
    const tomorrow = ymdAddDays(getIstDateString(), 1);

    // Pre-seed a future plan.
    const [preexisting] = await db
      .insert(dayPlans)
      .values({ execUserId: exec.id, planDate: tomorrow })
      .returning({ id: dayPlans.id });

    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Should attach to the preseeded future plan',
      estimatedTime: '30min',
      taskDate: tomorrow,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const futurePlans = await db
      .select({ id: dayPlans.id })
      .from(dayPlans)
      .where(
        and(eq(dayPlans.execUserId, exec.id), eq(dayPlans.planDate, tomorrow)),
      );
    expect(futurePlans).toHaveLength(1);
    expect(futurePlans[0].id).toBe(preexisting.id);

    const [task] = await db
      .select({ dayPlanId: tasks.dayPlanId })
      .from(tasks)
      .where(eq(tasks.id, res.data!.taskId))
      .limit(1);
    expect(task.dayPlanId).toBe(preexisting.id);
  });
});

describe('markTaskDoneAction — future-date guard', () => {
  it('rejects a task whose taskDate is in the future', async () => {
    const { exec, plan } = await setupExecWithTodayPlan();
    const tomorrow = ymdAddDays(getIstDateString(), 1);

    // Seed a Sales pitch task and then forcibly bump its taskDate into
    // the future. Sales pitch has chip outcomes (not free-text).
    const task = await seedTask({
      execUserId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Sales pitch',
    });
    await db
      .update(tasks)
      .set({ taskDate: tomorrow })
      .where(eq(tasks.id, task.id));

    const [chip] = await db
      .select({ id: outcomeOptions.id })
      .from(outcomeOptions)
      .where(
        and(
          eq(outcomeOptions.taskType, 'Sales pitch'),
          eq(outcomeOptions.code, 'quote_sent'),
        ),
      )
      .limit(1);

    const res = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: chip.id,
      outcomeNotes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/scheduled for the future/i);
  });
});
