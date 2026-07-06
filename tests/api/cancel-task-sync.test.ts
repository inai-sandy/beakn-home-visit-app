import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, dayPlans, tasks, visitRequests } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as trackCancelPost } from '@/app/api/track/[token]/cancel/route';
import { POST as markCustomerRejectedPost } from '@/app/api/requests/[id]/mark-customer-rejected/route';
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
// Regression: request cancellation propagates to the linked visit task
// =============================================================================
//
// Two independent cancellation write-paths (customer-initiated /track
// cancel, and staff-initiated mark-customer-rejected) each mark
// visit_requests cancelled — but pre-fix, neither touched the linked
// `tasks` row. The exec's /today (which reads by day_plan_id + filters
// eq(tasks.dayPlanId, plan.id) with no status filter pre-fix) kept
// showing the visit as a live pending task after the customer/staff had
// already cancelled the request.
//
// The fix (lib/visit-schedule/task-sync.ts cancelLinkedVisitTask) flips
// the linked pending visit task to status='cancelled' inside the same
// transaction as the request-level cancellation.
// =============================================================================

function buildCancelReq(body: unknown, token: string): Request {
  return new Request(`https://visits.beakn.in/api/track/${token}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCancelCtx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function buildRejectReq(body: unknown): Request {
  return new Request(
    'https://visits.beakn.in/api/requests/x/mark-customer-rejected',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function buildRejectCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function futureIso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(6, 0, 0, 0);
  return d.toISOString();
}

function istDateOf(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function seedScheduledVisitWithTask(seed: '1' | '2') {
  const captain = await seedCaptain({ phone: `+91994300000${seed}` });
  const city = await getOrCreateCity('Bangalore');
  // mark-customer-rejected authorizes captains via cities.captain_user_id
  // (not visit_requests.assigned_captain_user_id) — must be set for the
  // captain-path test below to reach the write path instead of 403ing.
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id, {
    phone: `+91994310000${seed}`,
    fullName: `Exec CancelSync ${seed}`,
    password: 'CancelSync#1',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ASSIGNED',
  });
  const visitStage = await getStatusStage('VISIT_SCHEDULED');
  const visitAt = futureIso(2);
  const visitDate = istDateOf(visitAt);
  await db
    .insert(dayPlans)
    .values({ execUserId: exec.id, planDate: visitDate });

  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  const scheduled = await scheduleVisitAction({
    requestId: req.id,
    nextStatusId: visitStage.id,
    visitScheduledAt: visitAt,
  });
  expect(scheduled.ok).toBe(true);

  const [task] = await db.select().from(tasks).where(eq(tasks.linkRequestId, req.id));
  expect(task).toBeDefined();
  expect(task!.status).toBe('pending');

  return { captain, city, exec, request: req, task: task! };
}

describe('customer /track cancel cancels the linked visit task (regression)', () => {
  it('marks the linked pending task cancelled', async () => {
    const { request, task } = await seedScheduledVisitWithTask('1');

    const [row] = await db
      .select({ trackingToken: visitRequests.trackingToken })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id));

    // Track cancel is an unauthenticated endpoint — clear the exec's
    // session cookie set up during seeding.
    currentCookieHeader = undefined;

    const res = await trackCancelPost(
      buildCancelReq({ reason: 'NO_LONGER_INTERESTED' }, row!.trackingToken!),
      buildCancelCtx(row!.trackingToken!),
    );
    expect(res.status).toBe(200);

    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(taskAfter).toBeDefined();
    expect(taskAfter!.status).toBe('cancelled');
  });
});

describe('mark-customer-rejected cancels the linked visit task (regression)', () => {
  it('marks the linked pending task cancelled', async () => {
    const { captain, request, task } = await seedScheduledVisitWithTask('2');

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await markCustomerRejectedPost(
      buildRejectReq({ reason: 'CHANGED_MIND' }),
      buildRejectCtx(request.id),
    );
    expect(res.status).toBe(200);

    const [taskAfter] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(taskAfter).toBeDefined();
    expect(taskAfter!.status).toBe('cancelled');
  });
});
