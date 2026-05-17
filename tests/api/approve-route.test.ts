import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  inAppNotifications,
  notificationRules,
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

import { POST } from '@/app/api/requests/[id]/approve/route';

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
// HVA-137: POST /api/requests/[id]/approve
// =============================================================================

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  await db
    .insert(notificationRules)
    .values({
      eventType: 'request.approved',
      channel: 'in_app',
      recipientRole: 'exec_assigned',
      enabled: true,
    })
    .onConflictDoNothing();
});

async function setupAtPendingCaptainApproval() {
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
  return { city, captain, exec, request: req };
}

describe('HVA-137 POST /api/requests/[id]/approve — happy paths', () => {
  it('captain-of-city approves → request moves to ORDER_EXECUTED_SUCCESSFULLY + audit + notification', async () => {
    const { captain, exec, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ note: 'Looks good, well executed.' }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);

    const terminal = await getStatusStage('ORDER_EXECUTED_SUCCESSFULLY');
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id))
      .limit(1);
    expect(vr.statusStageId).toBe(terminal.id);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, request.id));
    expect(audit.map((a) => a.eventType)).toContain('request_approved');

    await vi.waitFor(
      async () => {
        const inApp = await db
          .select({ userId: inAppNotifications.userId })
          .from(inAppNotifications)
          .where(eq(inAppNotifications.userId, exec.id));
        expect(inApp.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000, interval: 100 },
    );
  });

  it('super_admin approves → 200', async () => {
    const { request } = await setupAtPendingCaptainApproval();
    const admin = await seedSuperAdmin();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(200);
  });

  it('no note → 200, audit reason is null', async () => {
    const { captain, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(200);

    const audit = await db
      .select({ reason: auditLog.reason, eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, request.id));
    const approved = audit.find((a) => a.eventType === 'request_approved');
    expect(approved?.reason).toBeNull();
  });
});

describe('HVA-137 POST /api/requests/[id]/approve — rejections', () => {
  it('sales_executive → 403', async () => {
    const { exec, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(403);
  });

  it('captain of different city → 403', async () => {
    const { request } = await setupAtPendingCaptainApproval();
    const other = await seedCaptain({ phone: '+919000044444' });
    const sess = await loginByPhone(other.phone, other.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(403);
  });

  it('wrong current stage → 409', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'VISIT_SCHEDULED',
    });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({}), buildCtx(req.id));
    expect(res.status).toBe(409);
  });

  it('cancelled request → 409', async () => {
    const { captain, request } = await setupAtPendingCaptainApproval();
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
    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(409);
  });

  it('note > 500 chars → 400', async () => {
    const { captain, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ note: 'x'.repeat(501) }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });
});
