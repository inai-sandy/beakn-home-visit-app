import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, notificationRules, visitRequests } from '@/db/schema';
import { transitionRequestStatus } from '@/lib/status-transition';

// =============================================================================
// HVA-143: regression test for revalidatePath('/', 'layout')
// =============================================================================
//
// One representative route (reassign) covers the contract: every mutation
// route follows the same pattern of revalidatePath('/', 'layout') AFTER
// the transaction commits, on the success path only — error returns must
// NOT call it (there's nothing to invalidate).
//
// next/headers + next/cache are both mocked at the top of the file. The
// revalidatePath spy is asserted directly.
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

const revalidatePathMock = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

import { POST } from '@/app/api/requests/[id]/reassign/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

const VALID_REASON =
  'Veera is going on leave tomorrow — transferring continuity of the installation work to keep the timeline.';

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

beforeEach(async () => {
  revalidatePathMock.mockClear();
  await db
    .insert(notificationRules)
    .values([
      {
        eventType: 'request.reassigned',
        channel: 'in_app',
        recipientRole: 'exec_removed',
        enabled: true,
      },
      {
        eventType: 'request.reassigned',
        channel: 'in_app',
        recipientRole: 'exec_assigned',
        enabled: true,
      },
      {
        eventType: 'request.reassigned',
        channel: 'email',
        recipientRole: 'captain_acting',
        enabled: true,
      },
    ])
    .onConflictDoNothing();
});

async function setupAssignedAtVisitScheduled() {
  const city = await getOrCreateCity('Bangalore');
  const captain = await seedCaptain();
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const execA = await seedExecutive(captain.id);
  const execB = await seedExecutive(captain.id, {
    phone: '+919100022222',
    password: 'TestExec#B',
    fullName: 'Exec B',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    statusStageCode: 'SUBMITTED',
  });
  // Advance to VISIT_SCHEDULED with execA assigned.
  const assigned = await import('../helpers/db').then((m) =>
    m.getStatusStage('ASSIGNED'),
  );
  await transitionRequestStatus({
    requestId: req.id,
    nextStatusId: assigned.id,
    actorUserId: captain.id,
    actorRole: 'captain',
    preUpdate: async (tx) => {
      await tx
        .update(visitRequests)
        .set({
          assignedExecUserId: execA.id,
          assignedCaptainUserId: captain.id,
          assignedAt: new Date(),
        })
        .where(eq(visitRequests.id, req.id));
    },
  });
  const visitScheduled = await import('../helpers/db').then((m) =>
    m.getStatusStage('VISIT_SCHEDULED'),
  );
  await transitionRequestStatus({
    requestId: req.id,
    nextStatusId: visitScheduled.id,
    actorUserId: execA.id,
    actorRole: 'sales_executive',
  });
  return { captain, execA, execB, request: req };
}

describe("HVA-143: revalidatePath('/', 'layout') is called on success only", () => {
  it("success path calls revalidatePath('/', 'layout') exactly once", async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout');
  });

  it('validation failure path does NOT call revalidatePath (data unchanged)', async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    // Reason < 50 chars → 400 validation failure before any DB write.
    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: 'too short' }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('forbidden actor (sales_executive) does NOT call revalidatePath', async () => {
    const { execA, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(execA.phone, execA.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(403);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
