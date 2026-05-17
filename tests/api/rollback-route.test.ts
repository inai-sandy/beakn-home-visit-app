import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  inAppNotifications,
  requestStatusHistory,
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

import { POST } from '@/app/api/requests/[id]/rollback/route';

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
// HVA-141: POST /api/requests/[id]/rollback
// =============================================================================

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/rollback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function setupWithExecAtVisitCompleted() {
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

  // Advance through to VISIT_COMPLETED via the service so history rows
  // exist for each transition.
  const stages = ['ASSIGNED', 'VISIT_SCHEDULED', 'VISIT_COMPLETED'] as const;
  for (const code of stages) {
    const target = await getStatusStage(code);
    const result = await transitionRequestStatus({
      requestId: req.id,
      nextStatusId: target.id,
      actorUserId: exec.id,
      actorRole: 'sales_executive',
      preUpdate:
        code === 'ASSIGNED'
          ? async (tx) => {
              await tx
                .update(visitRequests)
                .set({
                  assignedExecUserId: exec.id,
                  assignedCaptainUserId: captain.id,
                  assignedAt: new Date(),
                })
                .where(eq(visitRequests.id, req.id));
            }
          : undefined,
    });
    if (!result.ok) {
      throw new Error(`fixture: failed to advance to ${code}: ${result.error}`);
    }
  }

  return { city, captain, exec, request: req };
}

describe('HVA-141 POST /api/requests/[id]/rollback — happy paths', () => {
  it('assigned exec at VISIT_COMPLETED rolls back to VISIT_SCHEDULED + dispatches captain in-app', async () => {
    const { captain, exec, request } = await setupWithExecAtVisitCompleted();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: 'Customer was not home; retrying.' }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      previousStage: { sequenceNumber: number };
      currentStage: { sequenceNumber: number };
    };
    expect(body.ok).toBe(true);
    expect(body.previousStage.sequenceNumber).toBe(4);
    expect(body.currentStage.sequenceNumber).toBe(3);

    // visit_requests reflects the rollback.
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id))
      .limit(1);
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');
    expect(vr.statusStageId).toBe(visitScheduled.id);

    // history has 4 rows now (3 forward + 1 rollback). The rollback
    // row has to_seq < from_seq.
    const history = await db
      .select({
        toStageId: requestStatusHistory.toStatusStageId,
        sequenceNumber: requestStatusHistory.sequenceNumber,
        transitionOrder: requestStatusHistory.transitionOrder,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, request.id));
    expect(history.length).toBe(4);
    const rollback = history.find((h) => h.transitionOrder === 4);
    expect(rollback).toBeDefined();
    expect(rollback?.toStageId).toBe(visitScheduled.id);
    expect(rollback?.sequenceNumber).toBe(3);

    // audit_log: status_rolled_back row written.
    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, request.id));
    expect(audit.map((a) => a.eventType)).toContain('status_rolled_back');

    // The dispatch fires via setImmediate after the response, so the
    // in-app row appears asynchronously. Poll with a generous timeout
    // — full-suite scheduling makes a fixed sleep flaky.
    await vi.waitFor(
      async () => {
        const inApp = await db
          .select({ userId: inAppNotifications.userId })
          .from(inAppNotifications)
          .where(eq(inAppNotifications.userId, captain.id));
        expect(inApp.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 2000, interval: 50 },
    );
  });

  it('captain-of-city rolls back → 200', async () => {
    const { captain, request } = await setupWithExecAtVisitCompleted();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(200);
  });

  it('super_admin rolls back → 200', async () => {
    const { request } = await setupWithExecAtVisitCompleted();
    const admin = await seedSuperAdmin();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(200);
  });

  it('reason omitted entirely → 200, reason stored as null', async () => {
    const { exec, request } = await setupWithExecAtVisitCompleted();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(200);

    const history = await db
      .select({
        reason: requestStatusHistory.reason,
        transitionOrder: requestStatusHistory.transitionOrder,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, request.id));
    const rollback = history.find((h) => h.transitionOrder === 4);
    expect(rollback?.reason).toBeNull();
  });
});

describe('HVA-141 POST /api/requests/[id]/rollback — rejections', () => {
  it('non-assigned exec → 403', async () => {
    const { captain, request } = await setupWithExecAtVisitCompleted();
    // Seed a SECOND exec on the same captain who isn't assigned to this request.
    const intruder = await seedExecutive(captain.id, {
      phone: '+919100099999',
      password: 'TestExec#2',
      fullName: 'Intruder Exec',
    });
    const sess = await loginByPhone(intruder.phone, intruder.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(403);
  });

  it('captain of different city → 403', async () => {
    const { request } = await setupWithExecAtVisitCompleted();
    const otherCaptain = await seedCaptain({ phone: '+919000022222' });
    const sess = await loginByPhone(otherCaptain.phone, otherCaptain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(403);
  });

  it('currentStage = SUBMITTED → 409', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'SUBMITTED',
    });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(req.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/cannot roll back from submitted/i);
  });

  it('currentStage = PENDING_CAPTAIN_APPROVAL → 409 (use Reject)', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const exec = await seedExecutive(captain.id);
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'PENDING_CAPTAIN_APPROVAL',
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(req.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/reject/i);
  });

  it('request already cancelled → 409', async () => {
    const { exec, request } = await setupWithExecAtVisitCompleted();
    // Mark cancelled directly.
    await db
      .update(visitRequests)
      .set({
        cancelledAt: new Date(),
        cancellationActor: 'exec',
        cancellationReasonCode: 'NO_LONGER_INTERESTED',
        updatedAt: new Date(),
      })
      .where(eq(visitRequests.id, request.id));

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/closed/i);
  });

  it('reason > 500 chars → 400', async () => {
    const { exec, request } = await setupWithExecAtVisitCompleted();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const longReason = 'x'.repeat(501);
    const res = await POST(
      buildReq({ reason: longReason }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });
});
