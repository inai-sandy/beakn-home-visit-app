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

  // HVA-317 CHANGES THIS TEST'S EXPECTATION ON PURPOSE.
  //
  // It previously asserted the generic status route advanced
  // ASSIGNED → VISIT_SCHEDULED. That transition has carried
  // requires_datetime=true since the workflow table was seeded, but the
  // engine read the flag and never enforced it — so the route would happily
  // move the stage with NO date, leaving a "scheduled" visit that was
  // scheduled for nothing. That is the same class of bug as the installation
  // stage having no date at all.
  //
  // Visits and installations are scheduled through scheduleVisitAction, which
  // owns the picker, writes the datetime and creates the auto-task. The UI
  // already routes there: AdvanceStatusButton opens the dialog instead of
  // POSTing when requires_datetime is on. So no user-facing path regresses —
  // what changes is that the bare HTTP call is now refused instead of
  // silently doing the wrong thing.
  it('refuses a dateless ASSIGNED → VISIT_SCHEDULED with DATETIME_REQUIRED (HVA-317)', async () => {
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
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('DATETIME_REQUIRED');

    // And the stage must NOT have moved — a refusal that still mutated would
    // be worse than the original bug.
    const [after] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(after!.statusStageId).not.toBe(visitScheduled.id);
  });
});

describe('POST /api/requests/[id]/status — captain city-ownership guard', () => {
  it('rejects a captain transitioning a request in another city (403), leaving the request unchanged', async () => {
    // Regression: the generic status route only ownership-checked sales
    // execs; any captain could drive any request in any city. Now a
    // captain is scoped to their own city, mirroring the sibling routes.
    const cityA = await getOrCreateCity('Bangalore');
    const captainA = await seedCaptain({ phone: '+919000022221' });
    await db
      .update(cities)
      .set({ captainUserId: captainA.id })
      .where(eq(cities.id, cityA.id));
    const execA = await seedExecutive(captainA.id, { phone: '+919100022221' });
    const req = await seedVisitRequest({
      cityId: cityA.id,
      statusStageCode: 'ASSIGNED',
      assignedExecUserId: execA.id,
      assignedCaptainUserId: captainA.id,
    });

    // A different captain who does not own cityA.
    const captainB = await seedCaptain({ phone: '+919000033331' });
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(captainB.phone, captainB.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ nextStatusId: visitScheduled.id }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/not in your assigned city/i);

    // No transition happened.
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    const assigned = await getStatusStage('ASSIGNED');
    expect(vr.statusStageId).toBe(assigned.id);
  });

  it("does not block the request's own-city captain with the city guard", async () => {
    const cityA = await getOrCreateCity('Bangalore');
    const captainA = await seedCaptain({ phone: '+919000044441' });
    await db
      .update(cities)
      .set({ captainUserId: captainA.id })
      .where(eq(cities.id, cityA.id));
    const execA = await seedExecutive(captainA.id, { phone: '+919100044441' });
    const req = await seedVisitRequest({
      cityId: cityA.id,
      statusStageCode: 'ASSIGNED',
      assignedExecUserId: execA.id,
      assignedCaptainUserId: captainA.id,
    });
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(captainA.phone, captainA.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ nextStatusId: visitScheduled.id }),
      buildCtx(req.id),
    );
    // The owning captain passes the city gate — whatever the outcome, it
    // must NOT be the cross-city denial.
    if (res.status === 403) {
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').not.toMatch(/not in your assigned city/i);
    }
  });
});

describe('POST /api/requests/[id]/status — HVA-137 PENDING_CAPTAIN_APPROVAL guard', () => {
  it('rejects any caller trying to transition out of PENDING_CAPTAIN_APPROVAL via this route (409 WRONG_ROUTE)', async () => {
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
    const terminal = await getStatusStage('ORDER_EXECUTED_SUCCESSFULLY');

    // Exec attempt — the previous HVA-68 gate already blocked this; now
    // the unified HVA-137 guard responds with WRONG_ROUTE instead.
    {
      const sess = await loginByPhone(exec.phone, exec.password);
      currentCookieHeader = sess.cookieHeader;
      const res = await POST(
        buildReq({ nextStatusId: terminal.id }),
        buildCtx(req.id),
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('WRONG_ROUTE');
    }

    // Captain attempt — same response: must use /approve or /reject.
    {
      const sess = await loginByPhone(captain.phone, captain.password);
      currentCookieHeader = sess.cookieHeader;
      const res = await POST(
        buildReq({ nextStatusId: terminal.id }),
        buildCtx(req.id),
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('WRONG_ROUTE');
    }
  });
});
