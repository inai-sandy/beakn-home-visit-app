import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, tasks, visitRequests } from '@/db/schema';
import { bulkReassignAffectedVisitsAction } from '@/lib/captain/rebalance-actions';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { loginByPhone } from '../helpers/auth';
import { getOrCreateCity, seedCaptain, seedExecutive, seedVisitRequest } from '../helpers/db';

// =============================================================================
// Regression: bulkReassignAffectedVisitsAction moves the linked visit task
// =============================================================================
//
// Same class of bug as the single-visit reassign route: pre-fix, the
// bulk rebalance flow (captain marks an exec unavailable + redistributes
// their future visits) flipped visit_requests.assigned_exec_user_id per
// row but never touched the linked `tasks` row. The task (and its
// day_plan_id) stayed on the outgoing exec, so the visit never showed up
// on the incoming exec's /today or calendar.
// =============================================================================

beforeEach(() => {
  currentCookieHeader = undefined;
});

function futureDate(daysFromNow: number): { at: Date; isoDate: string } {
  const at = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  return { at, isoDate: ist.toISOString().slice(0, 10) };
}

describe('bulkReassignAffectedVisitsAction re-anchors the linked visit task (regression)', () => {
  it('moves the linked pending task onto the incoming exec + repoints day_plan_id', async () => {
    const cap = await seedCaptain({
      phone: '+919942000001',
      fullName: 'Rebalance TaskSync Captain',
    });
    const fromExec = await seedExecutive(cap.id, {
      phone: '+919942000002',
      fullName: 'Outgoing Exec TaskSync',
    });
    const toExec = await seedExecutive(cap.id, {
      phone: '+919942000003',
      fullName: 'Incoming Exec TaskSync',
    });
    const city = await getOrCreateCity('Hyderabad');

    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: fromExec.id,
      statusStageCode: 'VISIT_SCHEDULED',
    });
    const { at: visitAt, isoDate: visitDate } = futureDate(3);
    await db
      .update(visitRequests)
      .set({ visitScheduledAt: visitAt, customerName: 'Rebalance Customer' })
      .where(eq(visitRequests.id, req.id));

    // Linked pending visit task on the outgoing exec's day plan for the
    // visit's date (mirrors what scheduleVisitAction would have created).
    const [fromPlan] = await db
      .insert(dayPlans)
      .values({ execUserId: fromExec.id, planDate: visitDate })
      .returning({ id: dayPlans.id });
    const [task] = await db
      .insert(tasks)
      .values({
        execUserId: fromExec.id,
        dayPlanId: fromPlan!.id,
        taskType: 'Customer home visit',
        description: 'Visit Rebalance Customer',
        estimatedTime: '01:00',
        taskDate: visitDate,
        linkRequestId: req.id,
        status: 'pending',
      })
      .returning({ id: tasks.id });

    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await bulkReassignAffectedVisitsAction({
      fromExecUserId: fromExec.id,
      reassignments: [{ requestId: req.id, toExecUserId: toExec.id }],
      reason: 'Outgoing exec is on unplanned leave for the rest of the week.',
    });
    expect(res.ok).toBe(true);

    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(taskAfter).toBeDefined();
    expect(taskAfter!.execUserId).toBe(toExec.id);
    expect(taskAfter!.dayPlanId).not.toBe(fromPlan!.id);
    expect(taskAfter!.dayPlanId).not.toBeNull();

    const [newPlan] = await db
      .select()
      .from(dayPlans)
      .where(eq(dayPlans.id, taskAfter!.dayPlanId!));
    expect(newPlan).toBeDefined();
    expect(newPlan!.execUserId).toBe(toExec.id);
    expect(newPlan!.planDate).toBe(visitDate);
  });
});
