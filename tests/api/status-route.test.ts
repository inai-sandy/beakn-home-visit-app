import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, visitRequests } from '@/db/schema';

// next/headers stub — the status route reads cookie for requireAuth +
// x-forwarded-for / user-agent for the transition service. Thread the
// session cookie through here per-test.
let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/status/route';

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
// HVA-139: server-side guard against the Submitted→Assigned bypass
// =============================================================================
//
// The generic /api/requests/[id]/status route can advance any stage
// forward — but Submitted→Assigned MUST go through the dedicated
// /api/requests/[id]/assign route so assigned_exec_user_id is set
// atomically with the stage flip. Without this guard a captain (or any
// caller — a stale client, a curl) could land a request at ASSIGNED with
// no exec assigned. That's the production bug Arjun ran into on Preethi.
//
// Defence-in-depth: the UI hides the "Move to Assigned" button at this
// stage via computeActionVisibility (HVA-139 — covered by
// tests/lib/request-detail.test.ts), but the server gate is the final
// authority.
// =============================================================================

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/requests/[id]/status — HVA-139 Submitted→Assigned guard', () => {
  it('rejects a captain trying to advance SUBMITTED → ASSIGNED via this route (409 WRONG_ROUTE)', async () => {
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
    const assigned = await getStatusStage('ASSIGNED');

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ nextStatusId: assigned.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      message?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('WRONG_ROUTE');
    expect(body.message).toMatch(/assign/i);

    // No stage transition happened.
    const [vr] = await db
      .select({
        statusStageId: visitRequests.statusStageId,
        assignedExecUserId: visitRequests.assignedExecUserId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    const submitted = await getStatusStage('SUBMITTED');
    expect(vr.statusStageId).toBe(submitted.id);
    expect(vr.assignedExecUserId).toBeNull();
  });

  it('rejects super_admin trying to advance SUBMITTED → ASSIGNED via this route (409 WRONG_ROUTE)', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const admin = await seedSuperAdmin();
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'SUBMITTED',
    });
    const assigned = await getStatusStage('ASSIGNED');

    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ nextStatusId: assigned.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe('WRONG_ROUTE');
  });

  it('lets an assigned exec advance ASSIGNED → VISIT_SCHEDULED unchanged (regression)', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const exec = await seedExecutive(captain.id);
    // Seed an already-ASSIGNED request to this exec so the forward
    // transition is to VISIT_SCHEDULED (seq 3) — not affected by the
    // HVA-139 guard.
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'ASSIGNED',
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ nextStatusId: visitScheduled.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      currentStage?: { sequenceNumber: number };
    };
    expect(body.ok).toBe(true);
    expect(body.currentStage?.sequenceNumber).toBe(3);
  });
});
