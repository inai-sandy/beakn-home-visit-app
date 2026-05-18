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
  visitRequests,
} from '@/db/schema';
import {
  deltaSign,
  loadPendingApprovals,
  loadPendingCollections,
  loadTeamExecStatuses,
  loadTeamPerformance,
} from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-80: Captain Dashboard query tests
// =============================================================================
//
// Tests target the data layer (lib/captain/dashboard-queries.ts) directly —
// the page component is a thin Promise.all wrapper around these.
// =============================================================================

const istToday = getIstDateString();
function istYesterday(): string {
  const t = new Date();
  t.setDate(t.getDate() - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

async function seedExecAndPlan(args: {
  captainId: string;
  phone: string;
  fullName: string;
}) {
  const exec = await seedExecutive(args.captainId, {
    phone: args.phone,
    password: 'TestExec#X',
    fullName: args.fullName,
  });
  const [plan] = await db
    .insert(dayPlans)
    .values({ execUserId: exec.id, planDate: istToday })
    .returning();
  return { exec, plan };
}

async function insertTask(args: {
  execId: string;
  dayPlanId: string;
  taskType: string;
  status: 'pending' | 'completed' | 'postponed';
  postponedToDate?: string;
  taskDate?: string;
}) {
  await db.insert(tasks).values({
    execUserId: args.execId,
    dayPlanId: args.dayPlanId,
    taskType: args.taskType as never,
    description: 'fixture task',
    estimatedTime: '30min',
    taskDate: args.taskDate ?? istToday,
    status: args.status,
    postponedToDate: args.postponedToDate ?? null,
  });
}

async function insertInboundPayment(args: {
  visitRequestId: string;
  execId: string;
  amountPaise: number;
  paymentDate?: string;
}) {
  await db.insert(payments).values({
    visitRequestId: args.visitRequestId,
    direction: 'inbound',
    amountPaise: args.amountPaise,
    paymentDate: args.paymentDate ?? istToday,
    mode: 'UPI',
    recordedByUserId: args.execId,
  });
}

beforeEach(async () => {
  await getOrCreateCity('Bangalore');
});

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

describe('deltaSign', () => {
  it('up / down / flat / unknown classification', () => {
    expect(deltaSign(10, 5)).toBe('up');
    expect(deltaSign(3, 5)).toBe('down');
    expect(deltaSign(5, 5)).toBe('flat');
    expect(deltaSign(null, 5)).toBe('unknown');
    expect(deltaSign(5, null)).toBe('unknown');
    expect(deltaSign(null, null)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Test #1 — performance aggregates across the team
// ---------------------------------------------------------------------------

describe('Test #1 — loadTeamPerformance aggregates across team', () => {
  it('sums visits and collections from two execs into the captain totals', async () => {
    const captain = await seedCaptain();
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));

    const { exec: execA, plan: planA } = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020001',
      fullName: 'Exec A',
    });
    const { exec: execB, plan: planB } = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020002',
      fullName: 'Exec B',
    });

    // ExecA: 2 customer-home-visit done, 1 sales-pitch done, 1 pending other
    await insertTask({ execId: execA.id, dayPlanId: planA.id, taskType: 'Customer home visit', status: 'completed' });
    await insertTask({ execId: execA.id, dayPlanId: planA.id, taskType: 'Customer home visit', status: 'completed' });
    await insertTask({ execId: execA.id, dayPlanId: planA.id, taskType: 'Sales pitch', status: 'completed' });
    await insertTask({ execId: execA.id, dayPlanId: planA.id, taskType: 'Other', status: 'pending' });

    // ExecB: 1 outlet-visit done, 1 postponed
    await insertTask({ execId: execB.id, dayPlanId: planB.id, taskType: 'Outlet visit', status: 'completed' });
    await insertTask({ execId: execB.id, dayPlanId: planB.id, taskType: 'Sales pitch', status: 'postponed' });

    // One inbound payment each.
    const req = await seedVisitRequest({ cityId: city.id, statusStageCode: 'SUBMITTED' });
    await insertInboundPayment({ visitRequestId: req.id, execId: execA.id, amountPaise: 50_000_00 });
    await insertInboundPayment({ visitRequestId: req.id, execId: execB.id, amountPaise: 25_000_00 });

    const perf = await loadTeamPerformance(captain.id);

    // Visits = customer_home_visit (2) + sales_pitch (1) + outlet_visit (1) = 4
    expect(perf.visits.actual).toBe(4);
    // Revenue in rupees: (50,000 + 25,000) = 75,000
    expect(perf.revenue.actual).toBe(75_000);
    // Tasks done = 4 (A: 3, B: 1). Done denom = 4 + 1 pending + 1 postponed = 6 → 66.67%
    expect(perf.taskCompletionPct.actual).toBeCloseTo((4 / 6) * 100, 1);
  });
});

// ---------------------------------------------------------------------------
// Test #2 — delta indicators wire the previous-day value into the response
// ---------------------------------------------------------------------------

describe('Test #2 — performance.previous returns yesterday value', () => {
  it('counts yesterday-dated tasks separately from today', async () => {
    const captain = await seedCaptain();
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const { exec, plan } = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020003',
      fullName: 'Exec Delta',
    });

    // Today: 1 customer home visit done
    await insertTask({
      execId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Customer home visit',
      status: 'completed',
    });

    // Yesterday: 3 customer home visit done (using a yesterday-dated taskDate
    // so the date-based aggregate query buckets them under yesterday).
    await insertTask({
      execId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Customer home visit',
      status: 'completed',
      taskDate: istYesterday(),
    });
    await insertTask({
      execId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Customer home visit',
      status: 'completed',
      taskDate: istYesterday(),
    });
    await insertTask({
      execId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Customer home visit',
      status: 'completed',
      taskDate: istYesterday(),
    });

    const perf = await loadTeamPerformance(captain.id);
    expect(perf.visits.actual).toBe(1);
    expect(perf.visits.previous).toBe(3);
    expect(deltaSign(perf.visits.actual, perf.visits.previous)).toBe('down');
  });
});

// ---------------------------------------------------------------------------
// Test #3 — pending approvals top-5 sorted DESC by completedAt
// ---------------------------------------------------------------------------

describe('Test #3 — loadPendingApprovals returns top 5 by completedAt DESC', () => {
  it('orders rows by the latest transition INTO PENDING_CAPTAIN_APPROVAL', async () => {
    const captain = await seedCaptain();
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const exec = await seedExecutive(captain.id, {
      phone: '+919100020004',
      password: 'TestExec#X',
      fullName: 'Pending Exec',
    });

    const pendingStage = await getStatusStage('PENDING_CAPTAIN_APPROVAL');
    const submitted = await getStatusStage('SUBMITTED');

    // Seed 3 requests already at PENDING_CAPTAIN_APPROVAL via direct update +
    // history rows with staggered changedAt timestamps.
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) {
      const r = await seedVisitRequest({
        cityId: city.id,
        statusStageCode: 'SUBMITTED',
      });
      await db
        .update(visitRequests)
        .set({
          statusStageId: pendingStage.id,
          assignedExecUserId: exec.id,
          customerName: `Customer ${i}`,
        })
        .where(eq(visitRequests.id, r.id));
      await db.insert(requestStatusHistory).values({
        requestId: r.id,
        fromStatusStageId: submitted.id,
        toStatusStageId: pendingStage.id,
        sequenceNumber: pendingStage.sequenceNumber,
        transitionOrder: 1,
        changedByUserId: exec.id,
        changedAt: new Date(now - (3 - i) * 60_000), // i=0 oldest, i=2 newest
      });
    }

    const { totalCount, topFive } = await loadPendingApprovals(captain.id);
    expect(totalCount).toBe(3);
    expect(topFive).toHaveLength(3);
    // Newest first
    expect(topFive[0].customerName).toBe('Customer 2');
    expect(topFive[2].customerName).toBe('Customer 0');
    expect(topFive[0].execName).toBe('Pending Exec');
  });
});

// ---------------------------------------------------------------------------
// Test #4 — Pending Collections aging buckets via quotation.submittedAt proxy
// ---------------------------------------------------------------------------

describe('Test #4 — loadPendingCollections buckets by quotation age', () => {
  it('classifies outstanding balance into 0-7 / 8-30 / 30+ buckets', async () => {
    const captain = await seedCaptain();
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const exec = await seedExecutive(captain.id, {
      phone: '+919100020005',
      password: 'TestExec#X',
      fullName: 'Collections Exec',
    });

    const now = Date.now();
    const ages = [3, 15, 45] as const;
    let expectedBuckets = { zeroToSeven: 0, eightToThirty: 0, thirtyPlus: 0 };

    for (const age of ages) {
      const r = await seedVisitRequest({
        cityId: city.id,
        statusStageCode: 'QUOTATION_GIVEN',
      });
      // Assign to our exec so the team filter matches.
      await db
        .update(visitRequests)
        .set({ assignedExecUserId: exec.id })
        .where(eq(visitRequests.id, r.id));
      // Quotation total: 10,000 rupees.
      const submittedAt = new Date(now - age * 24 * 60 * 60 * 1000);
      await db.insert(quotations).values({
        visitRequestId: r.id,
        totalOrderValuePaise: 10_000_00,
        submittedByUserId: exec.id,
        submittedAt,
      });
      // Partial payment: 4,000 rupees → 6,000 still due.
      await db.insert(payments).values({
        visitRequestId: r.id,
        direction: 'inbound',
        amountPaise: 4_000_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: exec.id,
      });
      const dueRupees = 6_000;
      if (age <= 7) expectedBuckets.zeroToSeven += dueRupees;
      else if (age <= 30) expectedBuckets.eightToThirty += dueRupees;
      else expectedBuckets.thirtyPlus += dueRupees;
    }

    const summary = await loadPendingCollections(captain.id);
    expect(summary.outstandingRequestCount).toBe(3);
    expect(summary.totalDueRupees).toBe(18_000);
    expect(summary.buckets.zeroToSeven).toBe(expectedBuckets.zeroToSeven);
    expect(summary.buckets.eightToThirty).toBe(expectedBuckets.eightToThirty);
    expect(summary.buckets.thirtyPlus).toBe(expectedBuckets.thirtyPlus);
  });

  it('excludes fully-paid quotations from the outstanding count', async () => {
    const captain = await seedCaptain();
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const exec = await seedExecutive(captain.id, {
      phone: '+919100020006',
      password: 'TestExec#X',
      fullName: 'Fully Paid Exec',
    });
    const r = await seedVisitRequest({ cityId: city.id, statusStageCode: 'ORDER_CONFIRMED' });
    await db
      .update(visitRequests)
      .set({ assignedExecUserId: exec.id })
      .where(eq(visitRequests.id, r.id));
    await db.insert(quotations).values({
      visitRequestId: r.id,
      totalOrderValuePaise: 5_000_00,
      submittedByUserId: exec.id,
    });
    await db.insert(payments).values({
      visitRequestId: r.id,
      direction: 'inbound',
      amountPaise: 5_000_00,
      paymentDate: istToday,
      mode: 'UPI',
      recordedByUserId: exec.id,
    });

    const summary = await loadPendingCollections(captain.id);
    expect(summary.outstandingRequestCount).toBe(0);
    expect(summary.totalDueRupees).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test #5 — exec status indicator transitions
// ---------------------------------------------------------------------------

describe('Test #5 — exec status indicator', () => {
  it('no day_plan → no_plan; row exists → in_progress; closedAt set → closed', async () => {
    const captain = await seedCaptain();
    const noPlanExec = await seedExecutive(captain.id, {
      phone: '+919100020010',
      password: 'TestExec#X',
      fullName: 'A No-plan',
    });
    const { exec: openExec } = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020011',
      fullName: 'B Open-plan',
    });
    const { exec: closedExec, plan: closedPlan } = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020012',
      fullName: 'C Closed-plan',
    });
    await db
      .update(dayPlans)
      .set({ closedAt: new Date() })
      .where(eq(dayPlans.id, closedPlan.id));

    const statuses = await loadTeamExecStatuses(captain.id);
    const map = new Map(statuses.map((s) => [s.userId, s.status]));
    expect(map.get(noPlanExec.id)).toBe('no_plan');
    expect(map.get(openExec.id)).toBe('in_progress');
    expect(map.get(closedExec.id)).toBe('closed');
  });

  it('isUnavailable on salesExecutives overrides status to unavailable', async () => {
    const captain = await seedCaptain();
    const exec = await seedExecutive(captain.id, {
      phone: '+919100020013',
      password: 'TestExec#X',
      fullName: 'D Unavailable',
    });
    await db
      .update(salesExecutives)
      .set({ isUnavailable: true })
      .where(eq(salesExecutives.userId, exec.id));

    const statuses = await loadTeamExecStatuses(captain.id);
    expect(statuses.find((s) => s.userId === exec.id)?.status).toBe(
      'unavailable',
    );
  });
});

// ---------------------------------------------------------------------------
// Test #6 — sort order: most-active first by done count, then visits, then name
// ---------------------------------------------------------------------------

describe('Test #6 — exec list sort order (most-active first)', () => {
  it('orders by today done count DESC, then visits DESC, then name ASC', async () => {
    const captain = await seedCaptain();
    const a = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020020',
      fullName: 'A Lazy',
    });
    const b = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020021',
      fullName: 'B Busy',
    });
    const c = await seedExecAndPlan({
      captainId: captain.id,
      phone: '+919100020022',
      fullName: 'C Mid',
    });

    // A: 0 done, B: 3 done, C: 1 done
    for (let i = 0; i < 3; i += 1) {
      await insertTask({
        execId: b.exec.id,
        dayPlanId: b.plan.id,
        taskType: 'Customer home visit',
        status: 'completed',
      });
    }
    await insertTask({
      execId: c.exec.id,
      dayPlanId: c.plan.id,
      taskType: 'Sales pitch',
      status: 'completed',
    });

    const statuses = await loadTeamExecStatuses(captain.id);
    expect(statuses.map((s) => s.fullName)).toEqual(['B Busy', 'C Mid', 'A Lazy']);
  });
});

// ---------------------------------------------------------------------------
// Test #8 — empty state for captains with no execs assigned
// ---------------------------------------------------------------------------

describe('Test #8 — empty state when captain has no execs', () => {
  it('returns an empty array (not throw) for the exec list', async () => {
    const captain = await seedCaptain();
    const statuses = await loadTeamExecStatuses(captain.id);
    expect(statuses).toEqual([]);
  });

  it('performance returns zero-valued metrics when team is empty', async () => {
    const captain = await seedCaptain();
    const perf = await loadTeamPerformance(captain.id);
    expect(perf.revenue.actual).toBe(0);
    expect(perf.visits.actual).toBe(0);
    expect(perf.quotations.actual).toBe(0);
    expect(perf.orders.actual).toBe(0);
  });

  it('pending collections returns zero summary when team is empty', async () => {
    const captain = await seedCaptain();
    const summary = await loadPendingCollections(captain.id);
    expect(summary.outstandingRequestCount).toBe(0);
    expect(summary.totalDueRupees).toBe(0);
  });
});
