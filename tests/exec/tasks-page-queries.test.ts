import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, tasks } from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import {
  loadExecAllPendingTasks,
  loadExecAllPostponedTasks,
  loadExecCompletedTasksPaginated,
  loadExecLastWeekOpenTasks,
} from '@/lib/exec/tasks-page-queries';
import { getIstDateString } from '@/lib/today/time';

import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';

// =============================================================================
// HVA-170: /tasks helpers
// =============================================================================

const istToday = getIstDateString();

async function captainExecPair() {
  const captain = await seedCaptain();
  await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919210900001',
    fullName: 'Tasks Page Exec',
  });
  return { captain, exec };
}

async function seedPlan(execUserId: string, planDate: string): Promise<string> {
  const [plan] = await db
    .insert(dayPlans)
    .values({ execUserId, planDate })
    .returning({ id: dayPlans.id });
  return plan.id;
}

async function seedTask(input: {
  execUserId: string;
  dayPlanId?: string | null;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  description?: string;
  postponedToDate?: string | null;
  completedAt?: Date | null;
}) {
  const [row] = await db
    .insert(tasks)
    .values({
      execUserId: input.execUserId,
      dayPlanId: input.dayPlanId ?? null,
      taskType: 'Customer home visit',
      description: input.description ?? 'Visit',
      estimatedTime: '30min',
      status: input.status,
      taskDate: input.taskDate,
      postponedToDate: input.postponedToDate ?? null,
      completedAt: input.completedAt ?? null,
    })
    .returning();
  return row;
}

// -----------------------------------------------------------------------------
// loadExecAllPendingTasks
// -----------------------------------------------------------------------------

describe('loadExecAllPendingTasks', () => {
  it('returns ALL pending tasks including future-dated', async () => {
    const { exec } = await captainExecPair();
    const tomorrow = offsetIstDate(istToday, 1);
    const nextWeek = offsetIstDate(istToday, 7);
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: istToday, description: 'Today' });
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: tomorrow, description: 'Tomorrow' });
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: nextWeek, description: 'Next week' });
    // Non-pending should NOT appear:
    await seedTask({ execUserId: exec.id, status: 'completed', taskDate: istToday, description: 'Done' });
    await seedTask({ execUserId: exec.id, status: 'postponed', taskDate: istToday, postponedToDate: tomorrow, description: 'Later' });

    const out = await loadExecAllPendingTasks(exec.id);
    expect(out.map((t) => t.description)).toEqual(['Today', 'Tomorrow', 'Next week']);
  });
});

// -----------------------------------------------------------------------------
// loadExecAllPostponedTasks
// -----------------------------------------------------------------------------

describe('loadExecAllPostponedTasks', () => {
  it('returns ALL postponed tasks including future-postponed', async () => {
    const { exec } = await captainExecPair();
    const yesterday = offsetIstDate(istToday, -1);
    const tomorrow = offsetIstDate(istToday, 1);
    const nextWeek = offsetIstDate(istToday, 7);
    await seedTask({ execUserId: exec.id, status: 'postponed', taskDate: yesterday, postponedToDate: yesterday, description: 'Overdue' });
    await seedTask({ execUserId: exec.id, status: 'postponed', taskDate: istToday, postponedToDate: tomorrow, description: 'Tomorrow' });
    await seedTask({ execUserId: exec.id, status: 'postponed', taskDate: istToday, postponedToDate: nextWeek, description: 'Next week' });

    const out = await loadExecAllPostponedTasks(exec.id);
    // ASC by postponedToDate: overdue → tomorrow → next week.
    expect(out.map((t) => t.description)).toEqual([
      'Overdue',
      'Tomorrow',
      'Next week',
    ]);
  });
});

// -----------------------------------------------------------------------------
// loadExecCompletedTasksPaginated
// -----------------------------------------------------------------------------

describe('loadExecCompletedTasksPaginated', () => {
  it('returns first page of 20 by default', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedPlan(exec.id, istToday);
    // Seed 25 completed tasks. completedAt staggered so order is deterministic.
    for (let i = 0; i < 25; i += 1) {
      const completedAt = new Date(Date.now() - i * 60_000);
      await seedTask({
        execUserId: exec.id,
        dayPlanId: planId,
        status: 'completed',
        taskDate: istToday,
        completedAt,
        description: `Task ${i}`,
      });
    }
    const result = await loadExecCompletedTasksPaginated(exec.id, { page: 1 });
    expect(result.tasks).toHaveLength(20);
    expect(result.pagination.totalCount).toBe(25);
    expect(result.pagination.totalPages).toBe(2);
    expect(result.pagination.currentPage).toBe(1);
  });

  it('page=2 returns the remaining 5', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedPlan(exec.id, istToday);
    for (let i = 0; i < 25; i += 1) {
      await seedTask({
        execUserId: exec.id,
        dayPlanId: planId,
        status: 'completed',
        taskDate: istToday,
        completedAt: new Date(Date.now() - i * 60_000),
      });
    }
    const result = await loadExecCompletedTasksPaginated(exec.id, { page: 2 });
    expect(result.tasks).toHaveLength(5);
  });

  it('applies date range filter', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedPlan(exec.id, istToday);
    const twoDaysAgo = offsetIstDate(istToday, -2);
    const threeDaysAgo = offsetIstDate(istToday, -3);
    // One completed today, one completed 2 days ago at 10:00 IST (well
    // inside the 2-days-ago IST day). Use a wide-enough window in the
    // filter assertion so we don't get bitten by half-open boundary
    // semantics — the lib helper covers exact boundaries via the SQL
    // `>= from::date AT TIME ZONE 'Asia/Kolkata'` and
    // `< (to+1)::date AT TIME ZONE 'Asia/Kolkata'` pattern.
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
      completedAt: new Date(),
      description: 'Today',
    });
    await seedTask({
      execUserId: exec.id,
      status: 'completed',
      taskDate: twoDaysAgo,
      // 12:00 IST on twoDaysAgo = 06:30 UTC on twoDaysAgo.
      completedAt: new Date(`${twoDaysAgo}T06:30:00.000Z`),
      description: 'Two days ago',
    });
    // Filter to just today.
    const onlyToday = await loadExecCompletedTasksPaginated(exec.id, {
      page: 1,
      dateFrom: istToday,
      dateTo: istToday,
    });
    expect(onlyToday.tasks.map((t) => t.description)).toEqual(['Today']);
    // Filter to a 3-day window covering twoDaysAgo only.
    const onlyOld = await loadExecCompletedTasksPaginated(exec.id, {
      page: 1,
      dateFrom: threeDaysAgo,
      dateTo: twoDaysAgo,
    });
    expect(onlyOld.tasks.map((t) => t.description)).toEqual(['Two days ago']);
  });

  it('groups by IST completed date, newest first', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedPlan(exec.id, istToday);
    const yesterday = offsetIstDate(istToday, -1);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
      completedAt: new Date(),
    });
    await seedTask({
      execUserId: exec.id,
      status: 'completed',
      taskDate: yesterday,
      completedAt: new Date(`${yesterday}T08:00:00.000Z`),
    });
    const result = await loadExecCompletedTasksPaginated(exec.id, { page: 1 });
    expect(result.groupedByDate.length).toBe(2);
    expect(result.groupedByDate[0].istDate).toBe(istToday);
    expect(result.groupedByDate[1].istDate).toBe(yesterday);
  });
});

// -----------------------------------------------------------------------------
// loadExecLastWeekOpenTasks
// -----------------------------------------------------------------------------

describe('loadExecLastWeekOpenTasks', () => {
  it('returns pending + postponed in the last 7 days only', async () => {
    const { exec } = await captainExecPair();
    const yesterday = offsetIstDate(istToday, -1);
    const sixDaysAgo = offsetIstDate(istToday, -6);
    const eightDaysAgo = offsetIstDate(istToday, -8);
    const tomorrow = offsetIstDate(istToday, 1);

    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: yesterday, description: 'In window pending' });
    await seedTask({ execUserId: exec.id, status: 'postponed', taskDate: sixDaysAgo, postponedToDate: yesterday, description: 'In window postponed' });
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: eightDaysAgo, description: 'Out of window' });
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: tomorrow, description: 'Future' });
    await seedTask({ execUserId: exec.id, status: 'completed', taskDate: yesterday, description: 'Done' });

    const out = await loadExecLastWeekOpenTasks(exec.id);
    const descriptions = out.map((t) => t.description);
    expect(descriptions).toContain('In window pending');
    expect(descriptions).toContain('In window postponed');
    expect(descriptions).not.toContain('Out of window');
    expect(descriptions).not.toContain('Future');
    expect(descriptions).not.toContain('Done');
  });
});
