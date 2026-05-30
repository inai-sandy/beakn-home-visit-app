import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities as citiesTable,
  payments,
  quotations,
  visitRequests,
} from '@/db/schema';
import { loadCaptainSidebarCounts } from '@/lib/captain/sidebar-counts';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// HVA-129: badge counts for the captain sidebar.
// Real-DB integration tests — no mocks. Mirrors the existing
// captain-dashboard test harness.

describe('loadCaptainSidebarCounts', () => {
  let captainUserId: string;
  let cityId: string;
  let execUserId: string;

  beforeEach(async () => {
    const captain = await seedCaptain({ phone: '+919000041111' });
    captainUserId = captain.id;
    const city = await getOrCreateCity('Bangalore');
    cityId = city.id;
    // Bind the city to the captain so visibility scope kicks in.
    await db
      .update(citiesTable)
      .set({ captainUserId })
      .where(eq(citiesTable.id, cityId));
    const exec = await seedExecutive(captainUserId, {
      phone: '+919100041111',
    });
    execUserId = exec.id;
  });

  it('returns all zeros for a captain with no cities (super_admin-like case)', async () => {
    const adminCaptain = await seedCaptain({ phone: '+919000041112' });
    // No cities bound to this captain.
    const result = await loadCaptainSidebarCounts(adminCaptain.id);
    expect(result).toEqual({
      newRequestsCount: 0,
      pendingApprovalsCount: 0,
      outstandingFinanceCount: 0,
      // HVA-199: captain has no cities → no team execs → no assists.
      openAssistCount: 0,
    });
  });

  it('newRequestsCount = SUBMITTED + unassigned in captain cities', async () => {
    // In scope: SUBMITTED + unassigned + not cancelled.
    await seedVisitRequest({ cityId, statusStageCode: 'SUBMITTED' });
    // Not "new" — assigned to exec.
    await seedVisitRequest({
      cityId,
      assignedExecUserId: execUserId,
      assignedCaptainUserId: captainUserId,
      statusStageCode: 'SUBMITTED',
    });
    // Not "new" — past SUBMITTED.
    await seedVisitRequest({
      cityId,
      assignedExecUserId: execUserId,
      assignedCaptainUserId: captainUserId,
      statusStageCode: 'VISIT_SCHEDULED',
    });
    const result = await loadCaptainSidebarCounts(captainUserId);
    expect(result.newRequestsCount).toBe(1);
  });

  it('pendingApprovalsCount = PENDING_CAPTAIN_APPROVAL stage in scope', async () => {
    await seedVisitRequest({
      cityId,
      assignedExecUserId: execUserId,
      assignedCaptainUserId: captainUserId,
      statusStageCode: 'PENDING_CAPTAIN_APPROVAL',
    });
    await seedVisitRequest({
      cityId,
      assignedExecUserId: execUserId,
      assignedCaptainUserId: captainUserId,
      statusStageCode: 'VISIT_SCHEDULED',
    });
    const result = await loadCaptainSidebarCounts(captainUserId);
    expect(result.pendingApprovalsCount).toBe(1);
  });

  it('outstandingFinanceCount = quoted requests with positive outstanding balance', async () => {
    // Two quoted requests: one fully paid, one with outstanding balance.
    const fullyPaid = await seedVisitRequest({
      cityId,
      assignedExecUserId: execUserId,
      assignedCaptainUserId: captainUserId,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    const partlyPaid = await seedVisitRequest({
      cityId,
      assignedExecUserId: execUserId,
      assignedCaptainUserId: captainUserId,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    await db.insert(quotations).values([
      {
        visitRequestId: fullyPaid.id,
        totalOrderValuePaise: 10000,
        submittedByUserId: execUserId,
        submittedAt: new Date(),
      },
      {
        visitRequestId: partlyPaid.id,
        totalOrderValuePaise: 10000,
        submittedByUserId: execUserId,
        submittedAt: new Date(),
      },
    ]);
    await db.insert(payments).values([
      {
        visitRequestId: fullyPaid.id,
        direction: 'inbound',
        amountPaise: 10000,
        paymentDate: '2026-05-28',
        mode: 'UPI',
        recordedByUserId: execUserId,
      },
      {
        visitRequestId: partlyPaid.id,
        direction: 'inbound',
        amountPaise: 4000,
        paymentDate: '2026-05-28',
        mode: 'UPI',
        recordedByUserId: execUserId,
      },
    ]);
    const result = await loadCaptainSidebarCounts(captainUserId);
    expect(result.outstandingFinanceCount).toBe(1);
  });

  it('cancelled requests are excluded from every count', async () => {
    const cancelledRow = await seedVisitRequest({
      cityId,
      statusStageCode: 'SUBMITTED',
    });
    await db
      .update(visitRequests)
      .set({ cancelledAt: new Date(), cancellationActor: 'customer' })
      .where(eq(visitRequests.id, cancelledRow.id));
    const result = await loadCaptainSidebarCounts(captainUserId);
    expect(result.newRequestsCount).toBe(0);
  });
});
