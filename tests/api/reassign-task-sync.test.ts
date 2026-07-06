import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, dayPlans, tasks } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/reassign/route';
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
// Regression: POST /api/requests/[id]/reassign moves the linked visit task
// =============================================================================
//
// Pre-fix, reassign only flipped visit_requests.assigned_exec_user_id. The
// linked `tasks` row (created by scheduleVisitAction) kept its ORIGINAL
// exec_user_id + day_plan_id — so the visit stayed on the outgoing exec's
// /today and calendar (the request said execB, the task said execA) and
// never appeared on the incoming exec's plan at all.
//
// The fix (lib/visit-schedule/task-sync.ts moveVisitTaskToExec) moves the
// task to the new exec and repoints day_plan_id to that exec's plan for
// the task's date.
// =============================================================================

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/reassign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_REASON =
  'Veera is going on leave tomorrow — transferring continuity of the installation work to keep the timeline.';

function futureIso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(6, 0, 0, 0); // clear of IST midnight boundary
  return d.toISOString();
}

function istDateOf(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function setupAssignedVisitWithTask() {
  const city = await getOrCreateCity('Bangalore');
  const captain = await seedCaptain({ phone: '+919941000001' });
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const execA = await seedExecutive(captain.id, {
    phone: '+919941000002',
    fullName: 'Exec A ReassignSync',
    password: 'ExecA#1',
  });
  const execB = await seedExecutive(captain.id, {
    phone: '+919941000003',
    password: 'ExecB#1',
    fullName: 'Exec B ReassignSync',
  });

  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: execA.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ASSIGNED',
  });
  const visitStage = await getStatusStage('VISIT_SCHEDULED');
  const visitAt = futureIso(3);
  const visitDate = istDateOf(visitAt);

  // Pre-create execA's day plan so the auto-task links to it (mirrors a
  // real Start-My-Day flow) — otherwise day_plan_id would be NULL and the
  // "moved to a NEW plan" assertion below would be trivially true.
  const [execAPlan] = await db
    .insert(dayPlans)
    .values({ execUserId: execA.id, planDate: visitDate })
    .returning({ id: dayPlans.id });

  const sess = await loginByPhone(execA.phone, execA.password);
  currentCookieHeader = sess.cookieHeader;
  const scheduled = await scheduleVisitAction({
    requestId: req.id,
    nextStatusId: visitStage.id,
    visitScheduledAt: visitAt,
  });
  expect(scheduled.ok).toBe(true);

  const [task] = await db.select().from(tasks).where(eq(tasks.linkRequestId, req.id));
  expect(task).toBeDefined();
  expect(task!.execUserId).toBe(execA.id);
  expect(task!.dayPlanId).toBe(execAPlan!.id);

  return { city, captain, execA, execB, request: req, task: task!, visitDate };
}

describe('reassign route re-anchors the linked visit task (regression)', () => {
  it('moves the task to the new exec and repoints day_plan_id to the new exec\'s plan', async () => {
    const { captain, execA, execB, request, task, visitDate } =
      await setupAssignedVisitWithTask();

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);

    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(taskAfter).toBeDefined();
    expect(taskAfter!.execUserId).toBe(execB.id);
    expect(taskAfter!.execUserId).not.toBe(execA.id);
    expect(taskAfter!.dayPlanId).not.toBeNull();

    const [newPlan] = await db
      .select()
      .from(dayPlans)
      .where(eq(dayPlans.id, taskAfter!.dayPlanId!));
    expect(newPlan).toBeDefined();
    expect(newPlan!.execUserId).toBe(execB.id);
    expect(newPlan!.planDate).toBe(visitDate);
  });
});
