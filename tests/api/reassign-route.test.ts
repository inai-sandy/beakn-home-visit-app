import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  inAppNotifications,
  notificationRules,
  requestExecAssignments,
  users,
  visitRequests,
} from '@/db/schema';
import { transitionRequestStatus } from '@/lib/status-transition';

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

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-140: POST /api/requests/[id]/reassign
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

// HVA-140 / harness: per-file truncate wipes notification_rules
// (engine.test.ts depends on that), so the reassigned seed from
// migration 0017 doesn't survive across tests. Re-insert before each
// test so the happy-path dispatch assertions can succeed.
beforeEach(async () => {
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
  const assigned = await getStatusStage('ASSIGNED');
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
  const visitScheduled = await getStatusStage('VISIT_SCHEDULED');
  await transitionRequestStatus({
    requestId: req.id,
    nextStatusId: visitScheduled.id,
    actorUserId: execA.id,
    actorRole: 'sales_executive',
  });

  return { city, captain, execA, execB, request: req };
}

describe('HVA-140 POST /api/requests/[id]/reassign — happy paths', () => {
  it('captain-of-city reassigns from execA to execB → 200, exec swap + audit + assignment row + notifications', async () => {
    const { captain, execA, execB, request } =
      await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      oldExec: { id: string };
      newExec: { id: string };
    };
    expect(body.ok).toBe(true);
    expect(body.oldExec.id).toBe(execA.id);
    expect(body.newExec.id).toBe(execB.id);

    // visit_requests reflects the new exec; stage unchanged.
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');
    const [vr] = await db
      .select({
        assignedExecUserId: visitRequests.assignedExecUserId,
        statusStageId: visitRequests.statusStageId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id))
      .limit(1);
    expect(vr.assignedExecUserId).toBe(execB.id);
    expect(vr.statusStageId).toBe(visitScheduled.id);

    // Assignment row recorded with the captain's reason + previous exec.
    const assignments = await db
      .select({
        fromExecUserId: requestExecAssignments.fromExecUserId,
        toExecUserId: requestExecAssignments.toExecUserId,
        captainUserId: requestExecAssignments.captainUserId,
        reason: requestExecAssignments.reason,
      })
      .from(requestExecAssignments)
      .where(eq(requestExecAssignments.requestId, request.id));
    expect(assignments.length).toBe(1);
    expect(assignments[0].fromExecUserId).toBe(execA.id);
    expect(assignments[0].toExecUserId).toBe(execB.id);
    expect(assignments[0].captainUserId).toBe(captain.id);
    expect(assignments[0].reason).toBe(VALID_REASON);

    // Audit row for request_reassigned.
    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, request.id));
    expect(audit.map((a) => a.eventType)).toContain('request_reassigned');

    // In-app notifications fired for both execs (fire-and-forget via
    // setImmediate; poll for them).
    await vi.waitFor(
      async () => {
        const inAppOld = await db
          .select({ userId: inAppNotifications.userId })
          .from(inAppNotifications)
          .where(eq(inAppNotifications.userId, execA.id));
        const inAppNew = await db
          .select({ userId: inAppNotifications.userId })
          .from(inAppNotifications)
          .where(eq(inAppNotifications.userId, execB.id));
        expect(inAppOld.length).toBeGreaterThanOrEqual(1);
        expect(inAppNew.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 2000, interval: 50 },
    );
  });

  it('super_admin can reassign across teams → 200', async () => {
    const { execB, request } = await setupAssignedAtVisitScheduled();
    const admin = await seedSuperAdmin();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);
  });
});

describe('HVA-140 POST /api/requests/[id]/reassign — rejections', () => {
  it('sales_executive → 403 (only captain/admin can reassign)', async () => {
    const { execA, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(execA.phone, execA.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(403);
  });

  it('captain of different city → 403', async () => {
    const { execB, request } = await setupAssignedAtVisitScheduled();
    const otherCaptain = await seedCaptain({ phone: '+919000022222' });
    const sess = await loginByPhone(otherCaptain.phone, otherCaptain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(403);
  });

  it('newExecUserId === current exec → 409', async () => {
    const { captain, execA, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execA.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already assigned/i);
  });

  it("target exec on different captain's team → 400", async () => {
    const { captain, request } = await setupAssignedAtVisitScheduled();
    const otherCaptain = await seedCaptain({ phone: '+919000033333' });
    const otherExec = await seedExecutive(otherCaptain.id, {
      phone: '+919100033333',
      password: 'TestExec#X',
      fullName: 'Cross-team Exec',
    });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: otherExec.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not on your team/i);
  });

  it('target user is not a sales executive → 400', async () => {
    const { captain, request } = await setupAssignedAtVisitScheduled();
    // The captain themselves is a user but not a sales_executive.
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: captain.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });

  it('target exec inactive → 400', async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    await db.update(users).set({ isActive: false }).where(eq(users.id, execB.id));
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/inactive/i);
  });

  it('request has no assigned exec → 409 (use Assign instead)', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const exec = await seedExecutive(captain.id);
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'SUBMITTED',
    });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: exec.id, reason: VALID_REASON }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
  });

  it('request cancelled → 409', async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    await db
      .update(visitRequests)
      .set({
        cancelledAt: new Date(),
        cancellationActor: 'captain',
        cancellationReasonCode: 'NO_LONGER_INTERESTED',
        updatedAt: new Date(),
      })
      .where(eq(visitRequests.id, request.id));
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(409);
  });

  it('reason < 50 chars → 400', async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: 'too short' }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });

  it('reason > 500 chars → 400', async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id, reason: 'x'.repeat(501) }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });

  it('no reason field → 400', async () => {
    const { captain, execB, request } = await setupAssignedAtVisitScheduled();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ newExecUserId: execB.id }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });
});
