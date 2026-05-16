import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';

// next/headers stub — assign route reads x-forwarded-for + x-request-id +
// cookie for the requireAuth session lookup. We thread the test session's
// cookie through here.
let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/assign/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedUser,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-109 Area 2: app/api/requests/[id]/assign/route.ts (HVA-81)
// =============================================================================
//
// Schema reality verified against shipped code:
//   - Route: POST /api/requests/[id]/assign (NOT /captain/...). Body:
//     {execUserId, note?}.
//   - Allowed roles: ['captain','super_admin']. Sales_exec → ForbiddenError → 403.
//   - sales_executives.captain_user_id is the team link (NOT users.captain_id).
//   - cities.captain_user_id is the city-owner link (read for ownership gate).
//   - Transition handled by lib/status-transition.ts with a preUpdate hook
//     that writes visit_requests.assigned_exec_user_id +
//     assigned_captain_user_id + assigned_at atomically with the
//     status_stage_id flip (SUBMITTED → ASSIGNED).
//   - audit_log writes: 'status_change' (from transition service) +
//     'request_assigned' (from this route).
//
// SHIPPED BEHAVIOR confirmed by reading the code:
//   - Captain → request NOT in their cities → 403 "Request is not in your
//     assigned cities."
//   - Captain → exec NOT on their team → 403 "Exec is not on your team."
//   - super_admin BYPASSES city + team ownership (escape hatch).
//   - Already-assigned: 409 "Request is already assigned."
//   - Non-SUBMITTED stage: 409 "Request is not in Submitted state..."
//   - Inactive exec: 409 "Exec is inactive."
// =============================================================================

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function setupCaptainOwningCityWithExec(cityName = 'Bangalore') {
  const city = await getOrCreateCity(cityName);
  const captain = await seedCaptain();
  // Make captain own the city.
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id);
  return { city, captain, exec };
}

describe('POST /api/requests/[id]/assign: happy path', () => {
  it('captain assigns own-city request to own-team exec → 200, writes assignment + history + audit', async () => {
    const { city, captain, exec } = await setupCaptainOwningCityWithExec();
    const req = await seedVisitRequest({ cityId: city.id });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      assignedExec: { id: string };
      previousStage: { sequenceNumber: number };
      currentStage: { sequenceNumber: number };
    };
    expect(body.ok).toBe(true);
    expect(body.assignedExec.id).toBe(exec.id);
    expect(body.previousStage.sequenceNumber).toBe(1);
    expect(body.currentStage.sequenceNumber).toBe(2);

    // visit_requests row updated atomically.
    const [vr] = await db
      .select({
        statusStageId: visitRequests.statusStageId,
        assignedExecUserId: visitRequests.assignedExecUserId,
        assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    const assigned = await getStatusStage('ASSIGNED');
    expect(vr.statusStageId).toBe(assigned.id);
    expect(vr.assignedExecUserId).toBe(exec.id);
    expect(vr.assignedCaptainUserId).toBe(captain.id);

    // history row written.
    const history = await db
      .select({ toStageId: requestStatusHistory.toStatusStageId })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, req.id));
    expect(history.length).toBe(1);
    expect(history[0].toStageId).toBe(assigned.id);

    // audit_log: both status_change AND request_assigned rows.
    const audit = await db
      .select({ eventType: auditLog.eventType, actorRole: auditLog.actorRole })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    const types = audit.map((a) => a.eventType).sort();
    expect(types).toContain('request_assigned');
    expect(types).toContain('status_change');
    const assignAudit = audit.find((a) => a.eventType === 'request_assigned');
    expect(assignAudit?.actorRole).toBe('captain');
  });

  it('super_admin assigns across teams + cities (escape hatch)', async () => {
    // Captain A owns Bangalore + has exec E1.
    const { city: blr, captain: capA, exec: execA } =
      await setupCaptainOwningCityWithExec('Bangalore');
    // Captain B owns Chennai (no relation to our request); super_admin must
    // still be able to act on the Bangalore request and assign execA.
    void capA;
    void execA;
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const req = await seedVisitRequest({ cityId: blr.id });

    const res = await POST(buildReq({ execUserId: execA.id }), buildCtx(req.id));
    expect(res.status).toBe(200);
    // Bookkeeping: assigned_captain_user_id should be set to the city's
    // owning captain (capA), not the super_admin.
    const [vr] = await db
      .select({
        assignedExecUserId: visitRequests.assignedExecUserId,
        assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.assignedExecUserId).toBe(execA.id);
    expect(vr.assignedCaptainUserId).toBe(capA.id);
  });
});

describe('POST /api/requests/[id]/assign: city + team ownership gates', () => {
  it('captain assigning a request NOT in their cities → 403', async () => {
    // Captain owns Bangalore; request is in Chennai (no captain link).
    const blr = await getOrCreateCity('Bangalore');
    const chn = await getOrCreateCity('Chennai');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, blr.id));
    const exec = await seedExecutive(captain.id);
    const req = await seedVisitRequest({ cityId: chn.id });

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not in your assigned cities/i);

    // No DB writes (request unchanged).
    const [vr] = await db
      .select({ assignedExecUserId: visitRequests.assignedExecUserId })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.assignedExecUserId).toBeNull();
  });

  it('captain assigning to an exec on DIFFERENT team → 403', async () => {
    const { city, captain } = await setupCaptainOwningCityWithExec();
    // Second captain with their own exec.
    const otherCaptain = await seedCaptain({ phone: '+919000022222' });
    const otherExec = await seedExecutive(otherCaptain.id, {
      phone: '+919100022222',
    });
    const req = await seedVisitRequest({ cityId: city.id });

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ execUserId: otherExec.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not on your team/i);
  });

  it('execUserId pointing at a non-exec user → 400', async () => {
    const { city, captain } = await setupCaptainOwningCityWithExec();
    // Seed a captain user (not in sales_executives table) — exec-row
    // lookup INNER JOIN fails → 400.
    const wrongType = await seedCaptain({ phone: '+919000033333' });
    const req = await seedVisitRequest({ cityId: city.id });

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ execUserId: wrongType.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not a sales executive/i);
  });
});

describe('POST /api/requests/[id]/assign: RBAC', () => {
  it('sales_executive → 403', async () => {
    const { city, captain, exec } = await setupCaptainOwningCityWithExec();
    const req = await seedVisitRequest({ cityId: city.id });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    void captain;

    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(403);
  });

  it('anonymous → 401', async () => {
    currentCookieHeader = undefined;
    const res = await POST(
      buildReq({ execUserId: '00000000-0000-7000-8000-000000000000' }),
      buildCtx('00000000-0000-7000-8000-000000000000'),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/requests/[id]/assign: state guards', () => {
  it('already-assigned request → 409', async () => {
    const { city, captain, exec } = await setupCaptainOwningCityWithExec();
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already assigned/i);
  });

  it('inactive exec → 409', async () => {
    const { city, captain } = await setupCaptainOwningCityWithExec();
    const inactiveExec = await seedExecutive(captain.id, {
      phone: '+919100044444',
      isActive: false,
    });
    const req = await seedVisitRequest({ cityId: city.id });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ execUserId: inactiveExec.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/inactive/i);
  });
});

describe('POST /api/requests/[id]/assign: input validation', () => {
  it('invalid request UUID → 400', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ execUserId: '00000000-0000-7000-8000-000000000000' }),
      buildCtx('not-a-uuid'),
    );
    expect(res.status).toBe(400);
  });

  it('unknown request UUID → 404', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ execUserId: '00000000-0000-7000-8000-000000000000' }),
      buildCtx('00000000-0000-7000-8000-000000000001'),
    );
    expect(res.status).toBe(404);
  });
});

void seedUser; // referenced by adjacent test files; harmless export-keepalive.
