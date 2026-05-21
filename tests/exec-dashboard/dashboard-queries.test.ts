import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, outcomeOptions, tasks } from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import {
  loadExecDashboardSummary,
  loadExecPendingTasks,
  loadExecPerformance,
  loadExecTodayTaskCounts,
} from '@/lib/exec/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// =============================================================================
// HVA-169: lib/exec/dashboard-queries tests
// =============================================================================

const istToday = getIstDateString();
const yesterday = offsetIstDate(istToday, -1);

async function captainExecPair() {
  const captain = await seedCaptain();
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919200500001',
    fullName: 'Dash Exec',
  });
  return { captain, city, exec };
}

async function seedDayPlan(
  execUserId: string,
  planDate: string,
  opts: { closedAt?: Date | null } = {},
): Promise<string> {
  const [plan] = await db
    .insert(dayPlans)
    .values({
      execUserId,
      planDate,
      closedAt: opts.closedAt ?? null,
    })
    .returning();
  return plan.id;
}

async function seedTask(input: {
  execUserId: string;
  dayPlanId?: string | null;
  status: 'pending' | 'completed' | 'postponed' | 'cancelled';
  taskDate: string;
  description?: string;
  rolledOverAt?: Date | null;
}) {
  const [row] = await db
    .insert(tasks)
    .values({
      execUserId: input.execUserId,
      dayPlanId: input.dayPlanId ?? null,
      taskType: 'Customer home visit',
      description: input.description ?? 'Visit a customer',
      estimatedTime: '30min',
      status: input.status,
      taskDate: input.taskDate,
      rolledOverAt: input.rolledOverAt ?? null,
    })
    .returning();
  return row;
}

// -----------------------------------------------------------------------------
// loadExecDashboardSummary — banner state machine
// -----------------------------------------------------------------------------

describe('loadExecDashboardSummary', () => {
  it('returns no_plan when no day_plan exists for today IST', async () => {
    const { exec } = await captainExecPair();
    const summary = await loadExecDashboardSummary(exec.id);
    expect(summary.banner.kind).toBe('no_plan');
    expect(summary.istDate).toBe(istToday);
  });

  it('returns in_progress mid-day with pending/done/postponed counts + next-pending title', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'pending',
      taskDate: istToday,
      description: 'Call Sandeep',
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
    });
    // Use 09:00 IST so we're well before any close-window threshold.
    const morning = new Date(`${istToday}T03:30:00.000Z`); // 09:00 IST
    const summary = await loadExecDashboardSummary(exec.id, morning);
    expect(summary.banner.kind).toBe('in_progress');
    if (summary.banner.kind !== 'in_progress') return;
    expect(summary.banner.pending).toBe(1);
    expect(summary.banner.done).toBe(1);
    expect(summary.banner.postponed).toBe(1);
    expect(summary.banner.nextPendingTaskTitle).toBe('Call Sandeep');
  });

  it('returns closed when day_plan.closedAt is set', async () => {
    const { exec } = await captainExecPair();
    const closedAt = new Date(`${istToday}T13:00:00.000Z`);
    await seedDayPlan(exec.id, istToday, { closedAt });
    const summary = await loadExecDashboardSummary(exec.id);
    expect(summary.banner.kind).toBe('closed');
    if (summary.banner.kind !== 'closed') return;
    expect(summary.banner.closedAt.getTime()).toBe(closedAt.getTime());
  });
});

// -----------------------------------------------------------------------------
// loadExecPendingTasks — today + rolled-over from past
// -----------------------------------------------------------------------------

describe('loadExecPendingTasks', () => {
  it('returns today pending tasks AND rolled-over tasks from past', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'pending',
      taskDate: istToday,
      description: 'Today task',
    });
    await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
      description: 'Yesterday rolled over',
      rolledOverAt: new Date(),
    });
    const out = await loadExecPendingTasks(exec.id);
    expect(out).toHaveLength(2);
    // Rolled-over rows surface first.
    expect(out[0].description).toBe('Yesterday rolled over');
    expect(out[0].rolledOverAt).not.toBeNull();
    expect(out[1].description).toBe('Today task');
    expect(out[1].rolledOverAt).toBeNull();
  });

  it('does not return tasks for a different exec', async () => {
    const { captain, exec } = await captainExecPair();
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919200500002',
      fullName: 'Other',
    });
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'pending',
      taskDate: istToday,
    });
    const otherOut = await loadExecPendingTasks(otherExec.id);
    expect(otherOut).toEqual([]);
  });

  it('excludes completed / postponed / past pending without rolled_over_at', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
    });
    // Past day, status=pending, rolled_over_at NOT set yet (cron hasn't run)
    await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
      rolledOverAt: null,
    });
    const out = await loadExecPendingTasks(exec.id);
    expect(out).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// loadExecTodayTaskCounts
// -----------------------------------------------------------------------------

describe('loadExecTodayTaskCounts', () => {
  it('counts pending (incl. rolled-over), postponed, completed scoped to today', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'pending',
      taskDate: istToday,
    });
    await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
      rolledOverAt: new Date(),
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
    });
    const counts = await loadExecTodayTaskCounts(exec.id);
    expect(counts).toEqual({ pending: 2, postponed: 1, completed: 2 });
  });
});

// -----------------------------------------------------------------------------
// loadExecPerformance — wrapper around loadPerformanceForExecIds
// -----------------------------------------------------------------------------

describe('loadExecPerformance', () => {
  it('returns a TeamPerformance shape with all 6 metrics + showTrafficLights + comparisonLabel', async () => {
    const { exec } = await captainExecPair();
    const perf = await loadExecPerformance(exec.id, { mode: 'single', date: istToday });
    expect(perf).toHaveProperty('revenue');
    expect(perf).toHaveProperty('visits');
    expect(perf).toHaveProperty('quotations');
    expect(perf).toHaveProperty('orders');
    expect(perf).toHaveProperty('conversionPct');
    expect(perf).toHaveProperty('taskCompletionPct');
    expect(perf.showTrafficLights).toBe(true);
    expect(typeof perf.comparisonLabel).toBe('string');
  });

  it('range mode disables traffic lights (matches captain dashboard rule)', async () => {
    const { exec } = await captainExecPair();
    const perf = await loadExecPerformance(exec.id, {
      mode: 'range',
      from: offsetIstDate(istToday, -6),
      to: istToday,
    });
    expect(perf.showTrafficLights).toBe(false);
  });

  it('counts only the queried exec, never other execs', async () => {
    const { captain, exec } = await captainExecPair();
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919200500003',
      fullName: 'Other',
    });
    const otherPlan = await seedDayPlan(otherExec.id, istToday);
    // Other exec has 5 done tasks today.
    for (let i = 0; i < 5; i += 1) {
      await seedTask({
        execUserId: otherExec.id,
        dayPlanId: otherPlan,
        status: 'completed',
        taskDate: istToday,
      });
    }
    // Queried exec has 1 done task today.
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
    });
    const perf = await loadExecPerformance(exec.id, {
      mode: 'single',
      date: istToday,
    });
    // Visits = customer-facing task-type completes. Our 'Customer home visit'
    // is in VISIT_TASK_TYPES, so visit count = 1 (not 6).
    expect(perf.visits.actual).toBe(1);
  });
});

// Silence unused-import lint for outcomeOptions in case future tests need it.
void outcomeOptions;
