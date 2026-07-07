import { eq, sql as sqlBuilder } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  cities as citiesTable,
  requestStatusHistory,
  users as usersTable,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-256: sticky account ownership — a returning contact's new web request
// auto-routes to the exec who most recently owned a request for that phone,
// instead of landing in the captain's unassigned queue.
// =============================================================================
//
// Mirrors the customer-request.test.ts harness: the route's POST is driven
// directly with hand-built Request objects. We mock the three side-effect
// modules the route touches (events, the notifications side-effect import,
// and next/headers) plus the notification engine so request.assigned can be
// asserted without a real send.

const emitSpy = vi.fn();
vi.mock('@/lib/events', () => ({
  emit: (...args: unknown[]) => {
    emitSpy(...args);
  },
  on: () => {},
}));
vi.mock('@/lib/notifications', () => ({}));

// Hoisted so the (hoisted) vi.mock factory below can reference it.
const { dispatchMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notifications/engine', () => ({
  dispatchNotification: dispatchMock,
}));

let currentRequestHeaders = new Headers();
vi.mock('next/headers', () => ({
  headers: async () => currentRequestHeaders,
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/customer-request/route';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

function buildReq(body: unknown, opts: { ip?: string } = {}): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  currentRequestHeaders = new Headers(headers);
  return new Request('https://visits.beakn.in/api/customer-request', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const BASE_PAYLOAD = {
  name: 'Returning Customer',
  email: 'return@example.com',
  address: '42 Sticky Lane, Indiranagar',
  city: 'Bangalore',
  state: 'Karnataka',
  bhk: '3 BHK',
  interest: ['Automation'],
  turnstileToken: 'XXXX.DUMMY.PASSES',
  whatsappOptIn: true,
};

/**
 * Insert a prior request for `phone` already assigned to `execUserId`. The
 * row is backdated 2 days so the route's 1-hour phone-dedup window does not
 * soft-block the fresh submission under test.
 */
async function seedPriorAssignedRequest(opts: {
  phoneStorage: string;
  cityId: string;
  execUserId: string;
  captainUserId: string;
  stageCode?: string;
}): Promise<string> {
  const stage = await getStatusStage(opts.stageCode ?? 'VISIT_SCHEDULED');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(visitRequests)
    .values({
      customerName: 'Returning Customer',
      customerPhone: opts.phoneStorage,
      customerEmail: null,
      address: 'Prior visit address',
      cityId: opts.cityId,
      bhk: '3BHK',
      interest: ['Automation'],
      trackingToken: `prior_${Math.random().toString(36).slice(2, 18)}`,
      statusStageId: stage.id,
      assignedExecUserId: opts.execUserId,
      assignedCaptainUserId: opts.captainUserId,
      assignedAt: twoDaysAgo,
      createdAt: twoDaysAgo,
    })
    .returning({ id: visitRequests.id });
  return row.id;
}

async function bindCityCaptain(cityId: string, captainUserId: string) {
  await db
    .update(citiesTable)
    .set({ captainUserId })
    .where(eq(citiesTable.id, cityId));
}

afterEach(async () => {
  emitSpy.mockReset();
  dispatchMock.mockReset();
  await db.execute(
    sqlBuilder.raw('TRUNCATE TABLE "rate_limit_attempts" RESTART IDENTITY;'),
  );
});

describe('HVA-256 sticky ownership: returning contact auto-assigns', () => {
  it('routes a new web request to the exec who owned the last request for that phone', async () => {
    const captain = await seedCaptain({ phone: '+919000090001' });
    const city = await getOrCreateCity('Bangalore');
    await bindCityCaptain(city.id, captain.id);
    const exec = await seedExecutive(captain.id, {
      phone: '+919100090001',
      fullName: 'Owning Exec',
    });
    const phone10 = '9876511111';
    await seedPriorAssignedRequest({
      phoneStorage: `+91${phone10}`,
      cityId: city.id,
      execUserId: exec.id,
      captainUserId: captain.id,
    });

    const res = await POST(
      buildReq({ ...BASE_PAYLOAD, phone: phone10 }, { ip: '10.9.0.1' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; trackingToken: string };

    const [vr] = await db
      .select({
        id: visitRequests.id,
        statusStageId: visitRequests.statusStageId,
        assignedExecUserId: visitRequests.assignedExecUserId,
        assignedCaptainUserId: visitRequests.assignedCaptainUserId,
        assignedAt: visitRequests.assignedAt,
        contactId: visitRequests.contactId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, body.trackingToken))
      .limit(1);

    const assignedStage = await getStatusStage('ASSIGNED');
    // Born assigned, not unassigned-SUBMITTED.
    expect(vr.statusStageId).toBe(assignedStage.id);
    expect(vr.assignedExecUserId).toBe(exec.id);
    expect(vr.assignedCaptainUserId).toBe(captain.id);
    expect(vr.assignedAt).not.toBeNull();
    // Contact linked (matches the existing lead by phone).
    expect(vr.contactId).not.toBeNull();

    // Initial null→ASSIGNED status-history row written.
    const hist = await db
      .select({
        fromStatusStageId: requestStatusHistory.fromStatusStageId,
        toStatusStageId: requestStatusHistory.toStatusStageId,
        transitionOrder: requestStatusHistory.transitionOrder,
        changedByUserId: requestStatusHistory.changedByUserId,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, vr.id));
    expect(hist).toHaveLength(1);
    expect(hist[0].fromStatusStageId).toBeNull();
    expect(hist[0].toStatusStageId).toBe(assignedStage.id);
    expect(hist[0].transitionOrder).toBe(1);
    // System actor — no human clicked Assign.
    expect(hist[0].changedByUserId).toBeNull();

    // The exec is notified via request.assigned (fire-and-forget).
    await vi.waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(
        'request.assigned',
        expect.objectContaining({
          requestId: vr.id,
          execUserId: exec.id,
          execName: 'Owning Exec',
        }),
      );
    });
  });

  it('follows the owning exec across cities (captain = the exec’s own captain)', async () => {
    const captain = await seedCaptain({ phone: '+919000090002' });
    const homeCity = await getOrCreateCity('Bangalore');
    await bindCityCaptain(homeCity.id, captain.id);
    const exec = await seedExecutive(captain.id, {
      phone: '+919100090002',
      fullName: 'Cross City Exec',
    });
    const phone10 = '9876522222';
    // Prior request in the exec's home city.
    await seedPriorAssignedRequest({
      phoneStorage: `+91${phone10}`,
      cityId: homeCity.id,
      execUserId: exec.id,
      captainUserId: captain.id,
    });
    // New request comes in for a DIFFERENT city.
    await getOrCreateCity('Hyderabad');

    const res = await POST(
      buildReq(
        { ...BASE_PAYLOAD, phone: phone10, city: 'Hyderabad', state: 'Telangana' },
        { ip: '10.9.0.2' },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackingToken: string };

    const [vr] = await db
      .select({
        assignedExecUserId: visitRequests.assignedExecUserId,
        assignedCaptainUserId: visitRequests.assignedCaptainUserId,
        statusStageId: visitRequests.statusStageId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, body.trackingToken))
      .limit(1);

    const assignedStage = await getStatusStage('ASSIGNED');
    expect(vr.statusStageId).toBe(assignedStage.id);
    // Still routed to the same exec, with the exec's OWN captain.
    expect(vr.assignedExecUserId).toBe(exec.id);
    expect(vr.assignedCaptainUserId).toBe(captain.id);
  });
});

describe('HVA-256 sticky ownership: fallbacks to the unassigned queue', () => {
  it('a brand-new phone stays unassigned at SUBMITTED', async () => {
    await getOrCreateCity('Bangalore');
    const res = await POST(
      buildReq(
        { ...BASE_PAYLOAD, phone: '9876533333', email: 'new@example.com' },
        { ip: '10.9.0.3' },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackingToken: string };

    const [vr] = await db
      .select({
        assignedExecUserId: visitRequests.assignedExecUserId,
        statusStageId: visitRequests.statusStageId,
        contactId: visitRequests.contactId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, body.trackingToken))
      .limit(1);

    const submittedStage = await getStatusStage('SUBMITTED');
    expect(vr.statusStageId).toBe(submittedStage.id);
    expect(vr.assignedExecUserId).toBeNull();
    expect(vr.contactId).toBeNull();
    // No auto-assign notification fired.
    await new Promise((r) => setImmediate(r));
    expect(dispatchMock).not.toHaveBeenCalledWith(
      'request.assigned',
      expect.anything(),
    );
  });

  it('falls back to unassigned when the owning exec is inactive', async () => {
    const captain = await seedCaptain({ phone: '+919000090004' });
    const city = await getOrCreateCity('Bangalore');
    await bindCityCaptain(city.id, captain.id);
    const exec = await seedExecutive(captain.id, {
      phone: '+919100090004',
      fullName: 'Departed Exec',
    });
    const phone10 = '9876544444';
    await seedPriorAssignedRequest({
      phoneStorage: `+91${phone10}`,
      cityId: city.id,
      execUserId: exec.id,
      captainUserId: captain.id,
    });
    // Exec has since been deactivated.
    await db
      .update(usersTable)
      .set({ isActive: false })
      .where(eq(usersTable.id, exec.id));

    const res = await POST(
      buildReq({ ...BASE_PAYLOAD, phone: phone10 }, { ip: '10.9.0.4' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trackingToken: string };

    const [vr] = await db
      .select({
        assignedExecUserId: visitRequests.assignedExecUserId,
        statusStageId: visitRequests.statusStageId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, body.trackingToken))
      .limit(1);

    const submittedStage = await getStatusStage('SUBMITTED');
    expect(vr.statusStageId).toBe(submittedStage.id);
    expect(vr.assignedExecUserId).toBeNull();
  });
});
