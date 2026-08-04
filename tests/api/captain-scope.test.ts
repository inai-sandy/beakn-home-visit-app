import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, visitRequests } from '@/db/schema';

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
import { computeActionVisibility } from '@/lib/request-detail';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
  withDatetimeGatesOff,
} from '../helpers/db';

// =============================================================================
// HVA-321: authority to act must match authority to view
// =============================================================================
//
// There were two definitions of "this captain owns this request" and they
// disagreed. Page access (HVA-258) allowed three paths — the captain accepted
// the request, the assigned exec reports to them, or they own the city — while
// computeActionVisibility and all seven /api/requests/[id]/* guards checked
// only the third.
//
// So a captain reaching a request via either of the other two paths saw the
// page with no action buttons at all. That is the "it was there before, now
// it's gone" report.
//
// The scenario below is the one that was broken and could not have been caught
// by the existing suite: every captain test used a captain who owned the city,
// which worked before and after. This one uses a captain who owns NO city and
// reaches the request purely through their team.
// =============================================================================

let seq = 0;

/** A request in cityA (owned by captainA) assigned to an exec who reports to
 *  captainB. captainB owns no city at all. */
async function seedCrossCityScenario() {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');

  const cityA = await getOrCreateCity('Bangalore');
  const captainA = await seedCaptain({ phone: `+9188${suffix}0000` });
  await db
    .update(cities)
    .set({ captainUserId: captainA.id })
    .where(eq(cities.id, cityA.id));

  const captainB = await seedCaptain({ phone: `+9187${suffix}0000` });
  const execB = await seedExecutive(captainB.id, {
    phone: `+9186${suffix}0000`,
    password: 'TeamScope#1',
  });

  const req = await seedVisitRequest({
    cityId: cityA.id,
    assignedExecUserId: execB.id,
    // Deliberately NOT assignedCaptainUserId — this leans purely on the
    // team relationship, the weakest of the three access paths.
    statusStageCode: 'ASSIGNED',
  });

  return { cityA, captainA, captainB, execB, request: req };
}

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('HVA-321: a captain acts on their own team’s request in another city', () => {
  it('lets the team captain advance it, though they own no city', async () => {
    const { captainB, request } = await seedCrossCityScenario();
    const visitCompleted = await getStatusStage('VISIT_COMPLETED');
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(captainB.phone, captainB.password);
    currentCookieHeader = sess.cookieHeader;

    // Park it at VISIT_SCHEDULED first (datetime-gated hop, see HVA-317).
    await withDatetimeGatesOff(async () => {
      const res = await POST(
        buildReq({ nextStatusId: visitScheduled.id }),
        { params: Promise.resolve({ id: request.id }) },
      );
      // Before HVA-321 this was a 403 "not in your assigned city".
      expect(res.status).toBe(200);
    });

    const res = await POST(
      buildReq({ nextStatusId: visitCompleted.id }),
      { params: Promise.resolve({ id: request.id }) },
    );
    expect(res.status).toBe(200);
    currentCookieHeader = undefined;

    const [after] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id))
      .limit(1);
    expect(after!.statusStageId).toBe(visitCompleted.id);
  });

  it('still refuses a captain with no connection to the request', async () => {
    // The widening must not become "any captain can act on anything". This
    // captain owns no city, has no team link, and did not accept the request.
    const { request } = await seedCrossCityScenario();
    seq += 1;
    const stranger = await seedCaptain({
      phone: `+9185${String(seq).padStart(5, '0')}0000`,
    });
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(stranger.phone, stranger.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ nextStatusId: visitScheduled.id }),
      { params: Promise.resolve({ id: request.id }) },
    );
    expect(res.status).toBe(403);
    currentCookieHeader = undefined;

    // And nothing moved.
    const [after] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, request.id))
      .limit(1);
    expect(after!.statusStageId).not.toBe(visitScheduled.id);
  });
});

describe('HVA-321: the buttons agree with the routes', () => {
  const CAPTAIN_ID = '55555555-5555-7555-8555-555555555555';
  const OTHER_CAPTAIN = '66666666-6666-7666-8666-666666666666';
  const EXEC_ID = '77777777-7777-7777-8777-777777777777';

  function baseInput() {
    return {
      role: 'captain' as const,
      userId: CAPTAIN_ID,
      currentStageCode: 'VISIT_SCHEDULED',
      assignedExecUserId: EXEC_ID,
      // Someone else owns the city — the old rule stopped here.
      cityCaptainUserId: OTHER_CAPTAIN,
      cancelledAt: null,
      hasNextStage: true,
      hasPreviousStage: true,
    };
  }

  it('shows actions to a captain who owns the request by team', () => {
    const vis = computeActionVisibility({
      ...baseInput(),
      captainOwnsRequest: true,
    });
    expect(vis.showAdvance).toBe(true);
    expect(vis.showRollback).toBe(true);
    expect(vis.showReassign).toBe(true);
  });

  it('hides them from a captain who does not own it', () => {
    const vis = computeActionVisibility({
      ...baseInput(),
      captainOwnsRequest: false,
    });
    expect(vis.showAdvance).toBe(false);
    expect(vis.showRollback).toBe(false);
    expect(vis.showReassign).toBe(false);
  });

  it('falls back to the city check when the flag is absent', () => {
    // Back-compat: every pre-HVA-321 call site omits the flag and must keep
    // its exact previous meaning.
    const denied = computeActionVisibility(baseInput());
    expect(denied.showAdvance).toBe(false);

    const allowed = computeActionVisibility({
      ...baseInput(),
      cityCaptainUserId: CAPTAIN_ID,
    });
    expect(allowed.showAdvance).toBe(true);
  });
});
