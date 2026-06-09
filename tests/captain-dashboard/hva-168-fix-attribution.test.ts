import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  dayPlans,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';
import {
  loadPendingApprovals,
  loadTeamPerformance,
  offsetIstDate,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { loadDayCloseMetrics } from '@/lib/today/metrics';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-168: fixes to Pending Approvals (snapshot-always) + Orders
// attribution (assigned exec, not transition actor).
// =============================================================================

const istToday = getIstDateString();
const todayFilter: DateFilter = { mode: 'single', date: istToday };

async function captainOwningBangalore() {
  const captain = await seedCaptain();
  const city = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  return { captain, city };
}

/**
 * Drop the request into the captain's pending bucket and record the
 * matching `request_status_history` row. `changedAt` lets the test
 * pin the transition to any window.
 */
async function pinAtPendingApproval(input: {
  cityId: string;
  customerName?: string;
  assignedExecUserId: string;
  assignedCaptainUserId?: string;
  changedByUserId: string;
  changedAt: Date;
}) {
  const req = await seedVisitRequest({
    cityId: input.cityId,
    statusStageCode: 'SUBMITTED',
  });
  const pending = await getStatusStage('PENDING_CAPTAIN_APPROVAL');
  await db
    .update(visitRequests)
    .set({
      statusStageId: pending.id,
      assignedExecUserId: input.assignedExecUserId,
      // HVA-258: loadPendingApprovals is team-scoped now (matches the
      // /captain/approvals page) — a pending-approval request always
      // has an accepting captain in real flow.
      assignedCaptainUserId: input.assignedCaptainUserId ?? null,
      customerName: input.customerName ?? 'Pending Customer',
    })
    .where(eq(visitRequests.id, req.id));
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: null,
    toStatusStageId: pending.id,
    sequenceNumber: pending.sequenceNumber,
    transitionOrder: 1,
    changedByUserId: input.changedByUserId,
    changedAt: input.changedAt,
  });
  return req.id;
}

/** Flip a pending request to ORDER_CONFIRMED — the order-of-record
 *  event for counting purposes. Real prod captain approval transitions
 *  PENDING → ORDER_EXECUTED_SUCCESSFULLY directly, but those terminal-
 *  positive requests have always had an earlier ORDER_CONFIRMED
 *  transition (sequence 6) created by the exec when the order was
 *  booked. The Metrics SSOT (2026-06-03) counts that booking event,
 *  not the terminal-positive event. */
async function approveAsCaptain(input: {
  requestId: string;
  captainUserId: string;
  changedAt: Date;
}) {
  const orderStage = await getStatusStage('ORDER_CONFIRMED');
  await db
    .update(visitRequests)
    .set({ statusStageId: orderStage.id })
    .where(eq(visitRequests.id, input.requestId));
  await db.insert(requestStatusHistory).values({
    requestId: input.requestId,
    fromStatusStageId: null,
    toStatusStageId: orderStage.id,
    sequenceNumber: orderStage.sequenceNumber,
    transitionOrder: 2,
    changedByUserId: input.captainUserId,
    changedAt: input.changedAt,
  });
}

// =============================================================================
// Pending Approvals — three behavioural assertions
// =============================================================================

describe('HVA-168 Fix 1 — loadPendingApprovals always uses snapshot semantic', () => {
  it('past-date filter excludes a request that has since been approved', async () => {
    const { captain, city } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200100001',
      fullName: 'Exec X',
    });

    const yesterday = offsetIstDate(istToday, -1);
    const yesterdayDate = new Date(`${yesterday}T08:00:00+05:30`);

    // Yesterday: request went into PENDING_CAPTAIN_APPROVAL.
    const reqId = await pinAtPendingApproval({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      changedByUserId: exec.id,
      changedAt: yesterdayDate,
    });
    // Yesterday: captain approved it. visit_requests.statusStageId now
    // points at ORDER_EXECUTED_SUCCESSFULLY.
    await approveAsCaptain({
      requestId: reqId,
      captainUserId: captain.id,
      changedAt: new Date(`${yesterday}T18:00:00+05:30`),
    });

    // Past-date single. Pre-HVA-168 this counted 1 (historical entry-
    // into-pending). Post-fix the snapshot says 0.
    const past = await loadPendingApprovals(captain.id, {
      mode: 'single',
      date: yesterday,
    });
    expect(past.totalCount).toBe(0);
    expect(past.topFive).toEqual([]);
  });

  it('range filter that brackets an approved transition still excludes it', async () => {
    const { captain, city } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200100002',
      fullName: 'Exec Y',
    });
    const reqId = await pinAtPendingApproval({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      changedByUserId: exec.id,
      changedAt: new Date(`${offsetIstDate(istToday, -1)}T08:00:00+05:30`),
    });
    await approveAsCaptain({
      requestId: reqId,
      captainUserId: captain.id,
      changedAt: new Date(`${offsetIstDate(istToday, -1)}T18:00:00+05:30`),
    });

    const range = await loadPendingApprovals(captain.id, {
      mode: 'range',
      from: offsetIstDate(istToday, -2),
      to: istToday,
    });
    expect(range.totalCount).toBe(0);
  });

  it('today still surfaces a currently-pending request — happy path unchanged', async () => {
    const { captain, city } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200100003',
      fullName: 'Exec Z',
    });
    await pinAtPendingApproval({
      cityId: city.id,
      customerName: 'Currently-Pending',
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      changedByUserId: exec.id,
      changedAt: new Date(`${istToday}T09:00:00+05:30`),
    });

    const r = await loadPendingApprovals(captain.id, todayFilter);
    expect(r.totalCount).toBe(1);
    expect(r.topFive).toHaveLength(1);
    expect(r.topFive[0].customerName).toBe('Currently-Pending');
  });
});

// =============================================================================
// Orders attribution — captain-driven approvals count for the team
// =============================================================================

describe('HVA-168 Fix 2 — loadTeamPerformance orders count captain-fired approvals', () => {
  it('counts a request whose ORDER transition was fired by the captain (not the exec)', async () => {
    const { captain, city } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200200001',
      fullName: 'Order Exec',
    });
    const reqId = await pinAtPendingApproval({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      changedByUserId: exec.id,
      changedAt: new Date(`${istToday}T08:00:00+05:30`),
    });
    // Captain fires the approval today. changedByUserId = captain
    // (NOT the exec). Pre-HVA-168 the orders predicate filtered by
    // changedByUserId and this row went uncounted.
    await approveAsCaptain({
      requestId: reqId,
      captainUserId: captain.id,
      changedAt: new Date(`${istToday}T11:00:00+05:30`),
    });

    const perf = await loadTeamPerformance(captain.id, todayFilter);
    expect(perf.orders.actual).toBe(1);
  });

  it('order attribution follows the assigned exec\'s team, not the city or the actor', async () => {
    // Setup: Cap A owns Bangalore. Cap B owns no cities here but
    // employs execB. Request is in Bangalore (Cap A's city) BUT
    // assigned to execB (Cap B's exec). Cap A fires the approval.
    //
    // New predicate scopes orders by assignedExec ∈ captain's team.
    //   - Cap A's team does NOT include execB → orders=0 for A.
    //   - Cap B's team DOES include execB → orders=1 for B, even
    //     though they didn't own the city and didn't fire the
    //     transition.
    const { captain: capA, city } = await captainOwningBangalore();
    const capB = await seedCaptain({
      phone: '+919000300002',
      fullName: 'Cap B',
    });
    const execB = await seedExecutive(capB.id, {
      phone: '+919200200002',
      fullName: 'Exec B',
    });
    const reqId = await pinAtPendingApproval({
      cityId: city.id,
      assignedExecUserId: execB.id,
      changedByUserId: execB.id,
      changedAt: new Date(`${istToday}T08:00:00+05:30`),
    });
    await approveAsCaptain({
      requestId: reqId,
      captainUserId: capA.id,
      changedAt: new Date(`${istToday}T11:00:00+05:30`),
    });

    const perfA = await loadTeamPerformance(capA.id, todayFilter);
    expect(perfA.orders.actual).toBe(0);

    const perfB = await loadTeamPerformance(capB.id, todayFilter);
    expect(perfB.orders.actual).toBe(1);
  });
});

// =============================================================================
// loadDayCloseMetrics — per-exec orders also count captain-fired approvals
// =============================================================================

describe('HVA-168 Fix 3 — loadDayCloseMetrics orders use assigned-exec attribution', () => {
  it('counts the captain-approved order against the assigned exec', async () => {
    const { captain, city } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200300001',
      fullName: 'Close Exec',
    });
    // Day plan exists today (required by loadDayCloseMetrics signature).
    const [plan] = await db
      .insert(dayPlans)
      .values({ execUserId: exec.id, planDate: istToday })
      .returning();

    const reqId = await pinAtPendingApproval({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      changedByUserId: exec.id,
      changedAt: new Date(`${istToday}T08:00:00+05:30`),
    });
    await approveAsCaptain({
      requestId: reqId,
      captainUserId: captain.id,
      changedAt: new Date(`${istToday}T11:00:00+05:30`),
    });

    const metrics = await loadDayCloseMetrics({
      execUserId: exec.id,
      dayPlanId: plan.id,
      dayPlanSubmittedAt: plan.submittedAt,
      istDateStr: istToday,
    });
    expect(metrics.targets.orders.actual).toBe(1);
  });

  it('does not count a request whose assignedExec is somebody else, even if the exec fired the transition', async () => {
    const { captain, city } = await captainOwningBangalore();
    const ownerExec = await seedExecutive(captain.id, {
      phone: '+919200300002',
      fullName: 'Owner',
    });
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919200300003',
      fullName: 'Other',
    });
    const [ownerPlan] = await db
      .insert(dayPlans)
      .values({ execUserId: ownerExec.id, planDate: istToday })
      .returning();
    const [otherPlan] = await db
      .insert(dayPlans)
      .values({ execUserId: otherExec.id, planDate: istToday })
      .returning();

    // Request assigned to Owner. Other exec / super_admin somehow fires
    // the order transition. New predicate ignores the actor — the
    // order belongs to Owner.
    const sa = await seedSuperAdmin({
      phone: '+918888400001',
      fullName: 'Admin 168',
    });
    const reqId = await pinAtPendingApproval({
      cityId: city.id,
      assignedExecUserId: ownerExec.id,
      changedByUserId: ownerExec.id,
      changedAt: new Date(`${istToday}T08:00:00+05:30`),
    });
    await approveAsCaptain({
      requestId: reqId,
      captainUserId: sa.id,
      changedAt: new Date(`${istToday}T11:00:00+05:30`),
    });

    const ownerMetrics = await loadDayCloseMetrics({
      execUserId: ownerExec.id,
      dayPlanId: ownerPlan.id,
      dayPlanSubmittedAt: ownerPlan.submittedAt,
      istDateStr: istToday,
    });
    const otherMetrics = await loadDayCloseMetrics({
      execUserId: otherExec.id,
      dayPlanId: otherPlan.id,
      dayPlanSubmittedAt: otherPlan.submittedAt,
      istDateStr: istToday,
    });
    expect(ownerMetrics.targets.orders.actual).toBe(1);
    expect(otherMetrics.targets.orders.actual).toBe(0);
  });
});
