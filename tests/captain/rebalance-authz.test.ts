import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, visitRequests } from '@/db/schema';

// Server actions read the session cookie via next/headers → getServerSession.
let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({
    get: () => (currentCookieHeader ? { value: currentCookieHeader } : undefined),
  }),
}));

import { bulkReassignAffectedVisitsAction } from '@/lib/captain/rebalance-actions';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// Bulk-rebalance IDOR guard
// =============================================================================
//
// The action validated that fromExecUserId and the destination execs belong
// to the captain, but never verified each requestId was actually assigned to
// fromExecUserId. A captain could pass a forged fromExecUserId (one they DO
// own) alongside request UUIDs belonging to a different exec and pull those
// visits onto their own team. The guard now rejects the whole batch if any
// selected request isn't currently assigned to the declared from-exec.
// =============================================================================

describe('bulkReassignAffectedVisitsAction — source-ownership guard', () => {
  it('rejects reassigning a request not currently assigned to fromExecUserId, leaving it untouched', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain({ phone: '+919000055551' });
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));

    // Two execs on the SAME captain's team.
    const execOwnedByCaptain = await seedExecutive(captain.id, {
      phone: '+919100055551',
    });
    const execActualOwner = await seedExecutive(captain.id, {
      phone: '+919100055552',
    });

    // Request is actually assigned to execActualOwner.
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'ASSIGNED',
      assignedExecUserId: execActualOwner.id,
      assignedCaptainUserId: captain.id,
    });

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    // Captain forges fromExecUserId = execOwnedByCaptain (which they DO own,
    // passing the from-exec team check) but the request belongs to
    // execActualOwner.
    const result = await bulkReassignAffectedVisitsAction({
      fromExecUserId: execOwnedByCaptain.id,
      reassignments: [{ requestId: req.id, toExecUserId: execOwnedByCaptain.id }],
      reason: 'Attempting to rebalance a visit for coverage today.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not currently assigned/i);
    }

    // The request is still assigned to its real owner — nothing moved.
    const [vr] = await db
      .select({ assignedExecUserId: visitRequests.assignedExecUserId })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.assignedExecUserId).toBe(execActualOwner.id);
  });
});
