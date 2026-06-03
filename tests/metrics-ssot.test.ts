import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  dayPlans,
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  tasks,
  users,
} from '@/db/schema';
import {
  loadAdminCounts,
  loadAdminGlobalMetrics,
  loadAdminRevenueSnapshot,
} from '@/lib/admin/dashboard-queries';
import { loadTeamPerformance } from '@/lib/captain/dashboard-queries';
import { loadMetrics } from '@/lib/metrics/registry';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from './helpers/db';

// =============================================================================
// Metrics SSOT — cross-portal regression
// =============================================================================
//
// Sandeep 2026-06-03: the recurring drift between admin / captain / exec
// numbers was the headline complaint. This test seeds a single-team
// single-city universe and asserts that every metric tile reads the
// same value through every loader, regardless of which portal called
// it. If any future refactor reintroduces drift (e.g. someone adds a
// bespoke order-counting query that uses ORDER_EXECUTED_SUCCESSFULLY
// instead of ORDER_CONFIRMED), this test fails first.
// =============================================================================

const istToday = getIstDateString();

beforeEach(async () => {
  await getOrCreateCity('Hyderabad');
});

describe('SSOT metrics — admin global vs captain team', () => {
  it('revenue / visits / orders / quotations agree across portals when there is one team in one city', async () => {
    const captain = await seedCaptain({ phone: '+919000099001' });
    const city = await getOrCreateCity('Hyderabad');
    await db.update(cities).set({ captainUserId: captain.id }).where(eq(cities.id, city.id));

    const exec = await seedExecutive(captain.id, {
      phone: '+919100099001',
      fullName: 'Exec One',
    });
    await db
      .update(salesExecutives)
      .set({ cityId: city.id })
      .where(eq(salesExecutives.userId, exec.id));

    // Seed a request, a quotation, a confirmed-order transition, a
    // visit task, an inbound payment — exactly the surfaces a tile
    // would read.
    const submitted = await getStatusStage('SUBMITTED');
    const confirmedStage = await getStatusStage('ORDER_CONFIRMED');

    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'SUBMITTED',
    });

    await db.insert(quotations).values({
      visitRequestId: req.id,
      totalOrderValuePaise: 500_00,
      submittedByUserId: exec.id,
    });

    await db.insert(requestStatusHistory).values({
      requestId: req.id,
      fromStatusStageId: submitted.id,
      toStatusStageId: confirmedStage.id,
      sequenceNumber: confirmedStage.sequenceNumber,
      transitionOrder: 1,
      changedByUserId: exec.id,
    });

    const [plan] = await db
      .insert(dayPlans)
      .values({ execUserId: exec.id, planDate: istToday })
      .returning();

    await db.insert(tasks).values({
      execUserId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Customer home visit',
      description: 'fixture visit',
      estimatedTime: '30min',
      taskDate: istToday,
      status: 'completed',
    });

    await db.insert(payments).values({
      visitRequestId: req.id,
      direction: 'inbound',
      amountPaise: 250_00,
      paymentDate: istToday,
      mode: 'UPI',
      recordedByUserId: exec.id,
    });

    // -----------------------------------------------------------------
    // Read the metrics through every portal's loader.
    // -----------------------------------------------------------------
    const range = { fromDate: istToday, toDate: istToday };

    const directMetrics = await loadMetrics(
      ['revenue', 'visits', 'orders_count', 'quotations_count'],
      {}, // global scope
      range,
    );
    const adminGlobal = await loadAdminGlobalMetrics(istToday);
    const adminRevenue = await loadAdminRevenueSnapshot(istToday);
    const captainPerf = await loadTeamPerformance(captain.id, {
      mode: 'single',
      date: istToday,
    });

    // Revenue: SSOT direct == admin (both in paise) == captain×100
    // (captain layer historically stores revenue in rupees so its
    // PerformanceCard formatter renders ₹ without dividing — we
    // compare numerically equivalent values rather than units).
    expect(adminGlobal.collectionsTodayPaise).toBe(directMetrics.revenue);
    expect(adminRevenue.receivedTodayPaise).toBe(directMetrics.revenue);
    expect((captainPerf.revenue.actual ?? 0) * 100).toBe(
      directMetrics.revenue,
    );

    // Visits.
    expect(adminGlobal.visitsToday).toBe(directMetrics.visits);
    expect(captainPerf.visits.actual).toBe(directMetrics.visits);

    // Orders (this is the one that was historically inconsistent —
    // admin used ORDER_EXECUTED_SUCCESSFULLY, captain used both, SSOT
    // uses ORDER_CONFIRMED only).
    expect(adminGlobal.completedOrdersToday).toBe(directMetrics.orders_count);
    expect(captainPerf.orders.actual).toBe(directMetrics.orders_count);

    // Quotations.
    expect(captainPerf.quotations.actual).toBe(directMetrics.quotations_count);
  });

  it('pending approvals + cancelled requests agree across admin counts and SSOT', async () => {
    const captain = await seedCaptain({ phone: '+919000099002' });
    const city = await getOrCreateCity('Hyderabad');
    await db.update(cities).set({ captainUserId: captain.id }).where(eq(cities.id, city.id));

    const exec = await seedExecutive(captain.id, { phone: '+919100099002' });
    await db
      .update(salesExecutives)
      .set({ cityId: city.id })
      .where(eq(salesExecutives.userId, exec.id));

    // One pending-approval, one cancelled-today.
    await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'PENDING_CAPTAIN_APPROVAL',
    });
    const cancelled = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'SUBMITTED',
    });
    const { visitRequests } = await import('@/db/schema');
    await db
      .update(visitRequests)
      .set({
        cancelledAt: new Date(),
        cancellationActor: 'exec',
        cancellationReason: 'fixture cancellation',
      })
      .where(eq(visitRequests.id, cancelled.id));

    const range = { fromDate: istToday, toDate: istToday };
    const direct = await loadMetrics(
      ['pending_approvals', 'cancelled_requests'],
      {},
      range,
    );
    const adminCounts = await loadAdminCounts(istToday);

    expect(adminCounts.pendingCaptainApprovals).toBe(direct.pending_approvals);
    expect(adminCounts.cancelledToday).toBe(direct.cancelled_requests);
  });
});

// Suppress an unused-import warning when the test file is type-checked
// without running (Vitest's no-runtime-side-effects mode).
void users;
