import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities, payments, quotations, tasks } from '@/db/schema';
import { loadLeaderboard } from '@/lib/leaderboard/queries';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// HVA-201: leaderboard ranking logic.

const today = getIstDateString();

async function seedCompletedVisit(
  execUserId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await db.insert(tasks).values({
      execUserId,
      taskType: 'Customer home visit',
      description: `Visit ${i}`,
      estimatedTime: '1hr',
      taskDate: today,
      status: 'completed',
      completedAt: new Date(),
    });
  }
}

async function seedRevenuePayment(
  execUserId: string,
  visitRequestId: string,
  amountPaise: number,
): Promise<void> {
  await db.insert(payments).values({
    visitRequestId,
    direction: 'inbound',
    amountPaise,
    paymentDate: today,
    mode: 'Cash',
    recordedByUserId: execUserId,
  });
}

describe('loadLeaderboard', () => {
  let captainId: string;
  let cityId: string;
  let execAlpha: string;
  let execBeta: string;
  let execGamma: string;
  let visitReqId: string;

  // Clean up any test-pollution cities from earlier broken runs of this
  // file (the testcontainer reuses across `pnpm test` invocations).
  beforeAll(async () => {
    await db.delete(cities).where(sql`${cities.name} LIKE 'LB-%'`);
  });

  beforeEach(async () => {
    // Make every test start clean of cities-captain assignments so we don't
    // inherit ranking attribution from prior tests.
    await db.update(cities).set({ captainUserId: null });

    const captain = await seedCaptain({
      phone: `+9190001${Math.floor(Math.random() * 99999)
        .toString()
        .padStart(5, '0')}`,
      fullName: 'Captain Test',
    });
    captainId = captain.id;
    // Reuse the existing seeded 'Bangalore' city. We re-point its captain
    // assignment within this test; the `beforeEach` resets all city→captain
    // links to NULL so we don't leak attribution into sibling tests.
    const city = await getOrCreateCity('Bangalore');
    cityId = city.id;
    await db
      .update(cities)
      .set({ captainUserId: captainId })
      .where(eq(cities.id, cityId));

    const a = await seedExecutive(captainId, {
      phone: `+9191001${Math.floor(Math.random() * 99999)
        .toString()
        .padStart(5, '0')}`,
      fullName: 'Alpha Exec',
    });
    const b = await seedExecutive(captainId, {
      phone: `+9191002${Math.floor(Math.random() * 99999)
        .toString()
        .padStart(5, '0')}`,
      fullName: 'Beta Exec',
    });
    const c = await seedExecutive(captainId, {
      phone: `+9191003${Math.floor(Math.random() * 99999)
        .toString()
        .padStart(5, '0')}`,
      fullName: 'Gamma Exec',
    });
    execAlpha = a.id;
    execBeta = b.id;
    execGamma = c.id;

    // A throwaway request for payments to attach to.
    const { seedVisitRequest } = await import('../helpers/db');
    visitReqId = (
      await seedVisitRequest({ cityId, assignedExecUserId: execAlpha })
    ).id;
  });

  it('returns every active exec even when nobody has any activity', async () => {
    const rows = await loadLeaderboard({
      metric: 'revenue',
      window: { mode: 'single', date: today },
    });
    const myExecs = rows.filter((r) =>
      [execAlpha, execBeta, execGamma].includes(r.execUserId),
    );
    expect(myExecs).toHaveLength(3);
    // All values 0; ranks share the same number (1) for the seeded execs
    // since they're all tied at zero. The exact rank depends on other
    // execs in the DB; we just check zero values.
    for (const r of myExecs) {
      expect(r.metricValue).toBe(0);
    }
  });

  it('ranks by revenue descending', async () => {
    await seedRevenuePayment(execAlpha, visitReqId, 10_000_00); // ₹10,000
    await seedRevenuePayment(execBeta, visitReqId, 50_000_00); // ₹50,000
    await seedRevenuePayment(execGamma, visitReqId, 25_000_00); // ₹25,000

    const rows = await loadLeaderboard({
      metric: 'revenue',
      window: { mode: 'single', date: today },
    });
    const byId = new Map(rows.map((r) => [r.execUserId, r]));
    expect(byId.get(execBeta)!.metricValue).toBe(50000);
    expect(byId.get(execGamma)!.metricValue).toBe(25000);
    expect(byId.get(execAlpha)!.metricValue).toBe(10000);

    // Top 3 of my seeded execs in order: Beta > Gamma > Alpha
    const orderedMine = rows
      .filter((r) =>
        [execAlpha, execBeta, execGamma].includes(r.execUserId),
      )
      .map((r) => r.execUserId);
    expect(orderedMine[0]).toBe(execBeta);
    expect(orderedMine[1]).toBe(execGamma);
    expect(orderedMine[2]).toBe(execAlpha);
  });

  it('ranks by visits descending', async () => {
    await seedCompletedVisit(execAlpha, 1);
    await seedCompletedVisit(execBeta, 5);
    await seedCompletedVisit(execGamma, 3);

    const rows = await loadLeaderboard({
      metric: 'visits',
      window: { mode: 'single', date: today },
    });
    const byId = new Map(rows.map((r) => [r.execUserId, r]));
    expect(byId.get(execAlpha)!.metricValue).toBe(1);
    expect(byId.get(execBeta)!.metricValue).toBe(5);
    expect(byId.get(execGamma)!.metricValue).toBe(3);
  });

  it('returns null conversion% when visits=0 but ranks others above', async () => {
    // Alpha: 0 visits, 0 orders → null conversion
    // Beta: 5 visits, 0 orders → 0% conversion
    // Gamma: no activity → null conversion
    await seedCompletedVisit(execBeta, 5);

    const rows = await loadLeaderboard({
      metric: 'conversion_pct',
      window: { mode: 'single', date: today },
    });
    const byId = new Map(rows.map((r) => [r.execUserId, r]));
    expect(byId.get(execAlpha)!.metricValue).toBeNull();
    expect(byId.get(execBeta)!.metricValue).toBe(0);
    expect(byId.get(execGamma)!.metricValue).toBeNull();

    // Beta (non-null 0%) ranks above Alpha + Gamma (null).
    const idx = (id: string) =>
      rows.findIndex((r) => r.execUserId === id);
    expect(idx(execBeta)).toBeLessThan(idx(execAlpha));
    expect(idx(execBeta)).toBeLessThan(idx(execGamma));
  });

  it('composite Beakn Score is a weighted blend of normalised metrics', async () => {
    // Beta dominates revenue (50k) + visits (5). Should have a higher
    // composite than execs with less.
    await seedRevenuePayment(execAlpha, visitReqId, 10_000_00);
    await seedRevenuePayment(execBeta, visitReqId, 50_000_00);
    await seedCompletedVisit(execAlpha, 1);
    await seedCompletedVisit(execBeta, 5);

    const rows = await loadLeaderboard({
      metric: 'composite',
      window: { mode: 'single', date: today },
    });
    const byId = new Map(rows.map((r) => [r.execUserId, r]));
    expect(byId.get(execBeta)!.compositeScore).toBeGreaterThan(
      byId.get(execAlpha)!.compositeScore,
    );
    expect(byId.get(execAlpha)!.compositeScore).toBeGreaterThan(
      byId.get(execGamma)!.compositeScore,
    );
    // All composite scores are 0–100.
    for (const r of rows) {
      expect(r.compositeScore).toBeGreaterThanOrEqual(0);
      expect(r.compositeScore).toBeLessThanOrEqual(100);
    }
  });

  it('ties on the primary metric break by revenue desc', async () => {
    // Alpha + Beta both with 3 visits, but Alpha has higher revenue.
    await seedCompletedVisit(execAlpha, 3);
    await seedCompletedVisit(execBeta, 3);
    await seedRevenuePayment(execAlpha, visitReqId, 20_000_00);
    await seedRevenuePayment(execBeta, visitReqId, 10_000_00);

    const rows = await loadLeaderboard({
      metric: 'visits',
      window: { mode: 'single', date: today },
    });
    const orderedMine = rows
      .filter((r) =>
        [execAlpha, execBeta].includes(r.execUserId),
      )
      .map((r) => r.execUserId);
    expect(orderedMine[0]).toBe(execAlpha); // higher revenue tie-breaks
    expect(orderedMine[1]).toBe(execBeta);
  });

  it('quotations metric counts rows by submitter in window', async () => {
    // Quotations is 1:1 with visit_requests (unique FK) — seed a fresh
    // visit request per quotation.
    const { seedVisitRequest } = await import('../helpers/db');
    const v1 = (await seedVisitRequest({ cityId, assignedExecUserId: execAlpha })).id;
    const v2 = (await seedVisitRequest({ cityId, assignedExecUserId: execAlpha })).id;
    const v3 = (await seedVisitRequest({ cityId, assignedExecUserId: execBeta })).id;
    await db.insert(quotations).values({
      visitRequestId: v1,
      quotationNumber: 'Q-1',
      totalOrderValuePaise: 100_000_00,
      submittedByUserId: execAlpha,
    });
    await db.insert(quotations).values({
      visitRequestId: v2,
      quotationNumber: 'Q-2',
      totalOrderValuePaise: 200_000_00,
      submittedByUserId: execAlpha,
    });
    await db.insert(quotations).values({
      visitRequestId: v3,
      quotationNumber: 'Q-3',
      totalOrderValuePaise: 50_000_00,
      submittedByUserId: execBeta,
    });

    const rows = await loadLeaderboard({
      metric: 'quotations',
      window: { mode: 'single', date: today },
    });
    const byId = new Map(rows.map((r) => [r.execUserId, r]));
    expect(byId.get(execAlpha)!.metricValue).toBe(2);
    expect(byId.get(execBeta)!.metricValue).toBe(1);
    expect(byId.get(execGamma)!.metricValue).toBe(0);
  });
});
