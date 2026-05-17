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

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/reject/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

const VALID_REASON =
  'The mounting bracket placement near the puja shelf needs adjustment. Please revisit with the customer.';

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/reject', {
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
      eventType: 'request.rejected',
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

describe('HVA-137 POST /api/requests/[id]/reject — happy paths', () => {
  it('captain-of-city rejects → moves to INSTALLATION_SCHEDULED + audit + notification', async () => {
    const { captain, exec, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);

    const installation = await getStatusStage('INSTALLATION_SCHEDULED');
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id))
      .limit(1);
    expect(vr.statusStageId).toBe(installation.id);

    const audit = await db
      .select({ eventType: auditLog.eventType, reason: auditLog.reason })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, request.id));
    const rejected = audit.find(
      (a) => a.eventType === 'request_rejected_by_captain',
    );
    expect(rejected).toBeDefined();
    expect(rejected?.reason).toBe(VALID_REASON);

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

  it('super_admin rejects → 200', async () => {
    const { request } = await setupAtPendingCaptainApproval();
    const admin = await seedSuperAdmin();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(200);
  });
});

describe('HVA-137 POST /api/requests/[id]/reject — rejections', () => {
  it('sales_executive → 403', async () => {
    const { exec, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: VALID_REASON }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(403);
  });

  it('captain of different city → 403', async () => {
    const { request } = await setupAtPendingCaptainApproval();
    const other = await seedCaptain({ phone: '+919000055555' });
    const sess = await loginByPhone(other.phone, other.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: VALID_REASON }),
      buildCtx(request.id),
    );
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
    const res = await POST(
      buildReq({ reason: VALID_REASON }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
  });

  it('reason < 50 chars → 400', async () => {
    const { captain, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'too short' }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });

  it('reason > 500 chars → 400', async () => {
    const { captain, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'x'.repeat(501) }),
      buildCtx(request.id),
    );
    expect(res.status).toBe(400);
  });

  it('no reason → 400', async () => {
    const { captain, request } = await setupAtPendingCaptainApproval();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({}), buildCtx(request.id));
    expect(res.status).toBe(400);
  });
});
