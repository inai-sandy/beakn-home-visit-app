import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, outcomeOptions, payments, tasks } from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import {
  loadExecBestOfPeriod,
  loadExecDashboardSummary,
  loadExecPendingTasks,
  loadExecPerformance,
  loadExecPostponedTasksOpen,
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
  postponedToDate?: string | null;
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
      postponedToDate: input.postponedToDate ?? null,
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

  // 2026-05-26 Option B: Dashboard count aligns with /tasks (all pending,
  // no date filter). A past-day pending row that hasn't been rolled over
  // yet is still "pending work I owe" and now surfaces here too. Only
  // completed + postponed are filtered out by the status predicate.
  it('excludes completed / postponed; includes ALL pending regardless of date', async () => {
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
    // Past day, status=pending, rolled_over_at NOT set yet (cron hasn't run).
    // Pre-Option-B this was hidden; post-Option-B it surfaces.
    await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
      rolledOverAt: null,
      description: 'Past pending no roll-over',
    });
    const out = await loadExecPendingTasks(exec.id);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe('Past pending no roll-over');
  });
});

// -----------------------------------------------------------------------------
// loadExecTodayTaskCounts
// -----------------------------------------------------------------------------

describe('loadExecTodayTaskCounts', () => {
  it('counts pending (incl. rolled-over), postponed (today + overdue), completed', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    // pending today
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'pending',
      taskDate: istToday,
    });
    // pending rolled-over from yesterday
    await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
      rolledOverAt: new Date(),
    });
    // postponed TO today (still actionable, today's target)
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: istToday,
    });
    // HVA-171: postponed TO a past date — overdue — must now count.
    await seedTask({
      execUserId: exec.id,
      status: 'postponed',
      taskDate: offsetIstDate(istToday, -5),
      postponedToDate: yesterday,
    });
    // HVA-171: postponed TO a future date — hidden by design, must NOT count.
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: offsetIstDate(istToday, 3),
    });
    // completed today × 2
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
    expect(counts).toEqual({ pending: 2, postponed: 2, completed: 2 });
  });
});

// -----------------------------------------------------------------------------
// loadExecPostponedTasksOpen (HVA-171 — was loadExecPostponedTasksToday)
// -----------------------------------------------------------------------------

describe('loadExecPostponedTasksOpen', () => {
  it('returns a task postponed TO today', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: istToday,
      description: 'Today target',
    });
    const out = await loadExecPostponedTasksOpen(exec.id);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe('Today target');
  });

  it('returns an overdue task (postponed TO a past date) — original Sandeep bug', async () => {
    const { exec } = await captainExecPair();
    // Task enrolled 5 days ago, postponed to 2 days ago, today is now today.
    await seedTask({
      execUserId: exec.id,
      status: 'postponed',
      taskDate: offsetIstDate(istToday, -5),
      postponedToDate: offsetIstDate(istToday, -2),
      description: 'Abandoned task',
    });
    const out = await loadExecPostponedTasksOpen(exec.id);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe('Abandoned task');
    expect(out[0].postponedToDate).toBe(offsetIstDate(istToday, -2));
  });

  it('does NOT return a task postponed TO a future date', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: offsetIstDate(istToday, 3),
    });
    const out = await loadExecPostponedTasksOpen(exec.id);
    expect(out).toEqual([]);
  });

  it('does NOT return tasks with non-postponed statuses', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'pending',
      taskDate: istToday,
      postponedToDate: istToday, // contrived; pending shouldn't carry one but defensive check
    });
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'completed',
      taskDate: istToday,
      postponedToDate: istToday,
    });
    const out = await loadExecPostponedTasksOpen(exec.id);
    expect(out).toEqual([]);
  });

  it('orders overdue rows by oldest target date first, then today', async () => {
    const { exec } = await captainExecPair();
    const planId = await seedDayPlan(exec.id, istToday);
    await seedTask({
      execUserId: exec.id,
      dayPlanId: planId,
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: istToday,
      description: 'Today',
    });
    await seedTask({
      execUserId: exec.id,
      status: 'postponed',
      taskDate: offsetIstDate(istToday, -10),
      postponedToDate: offsetIstDate(istToday, -7),
      description: 'Very overdue',
    });
    await seedTask({
      execUserId: exec.id,
      status: 'postponed',
      taskDate: offsetIstDate(istToday, -3),
      postponedToDate: offsetIstDate(istToday, -1),
      description: 'Slightly overdue',
    });
    const out = await loadExecPostponedTasksOpen(exec.id);
    expect(out.map((r) => r.description)).toEqual([
      'Very overdue',
      'Slightly overdue',
      'Today',
    ]);
  });

  it('does NOT return another exec\'s postponed tasks', async () => {
    const { captain, exec } = await captainExecPair();
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919200800001',
      fullName: 'Other Exec',
    });
    await seedTask({
      execUserId: otherExec.id,
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: istToday,
    });
    const out = await loadExecPostponedTasksOpen(exec.id);
    expect(out).toEqual([]);
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

// =============================================================================
// HVA-201 attribution sweep (2026-06-01) — loadExecBestOfPeriod "Top customer"
// =============================================================================

describe('loadExecBestOfPeriod — top customer attribution', () => {
  it('REGRESSION (2026-06-01): credits the exec when the captain records the payment on their behalf', async () => {
    const { captain, city, exec } = await captainExecPair();
    const { seedVisitRequest } = await import('../helpers/db');
    const req = (
      await seedVisitRequest({
        cityId: city.id,
        assignedExecUserId: exec.id,
      })
    ).id;
    // Captain records a ₹5,000 inbound payment on the exec's request —
    // exactly the prod scenario that surfaced the leaderboard bug.
    await db.insert(payments).values({
      visitRequestId: req,
      direction: 'inbound',
      amountPaise: 500_000,
      paymentDate: istToday,
      mode: 'Cash',
      recordedByUserId: captain.id, // captain, NOT exec
    });

    const result = await loadExecBestOfPeriod({
      execUserId: exec.id,
      from: istToday,
      to: istToday,
    });

    // Exec's top customer shows the captain-recorded payment.
    expect(result.topCustomer).not.toBeNull();
    expect(result.topCustomer!.totalCollectedPaise).toBe(500_000);
  });

  it('does NOT surface payments recorded by this exec on OTHER execs\' requests', async () => {
    // The reverse: this exec recorded a payment on someone else's request
    // (rare but possible). Should NOT appear as this exec's top customer
    // — the customer belongs to the other exec.
    const { captain, city, exec } = await captainExecPair();
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919200500099',
      fullName: 'Other Exec',
    });
    const { seedVisitRequest } = await import('../helpers/db');
    const otherReq = (
      await seedVisitRequest({
        cityId: city.id,
        assignedExecUserId: otherExec.id,
      })
    ).id;
    await db.insert(payments).values({
      visitRequestId: otherReq,
      direction: 'inbound',
      amountPaise: 1_000_000,
      paymentDate: istToday,
      mode: 'Cash',
      recordedByUserId: exec.id, // this exec acted on the other's behalf
    });

    const result = await loadExecBestOfPeriod({
      execUserId: exec.id,
      from: istToday,
      to: istToday,
    });

    // This exec has no own deals → no top customer.
    expect(result.topCustomer).toBeNull();
  });
});
