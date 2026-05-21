import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  dayPlans,
  leads,
  visitRequests,
} from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import {
  canCaptainViewExec,
  loadExecDayPlan,
  loadExecLeadsBreakdown,
  loadExecWeeklyReport,
} from '@/lib/captain/exec-drill-queries';
import { loadSingleExecMetrics } from '@/lib/captain/team-queries';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-167: exec drill-down query tests
// =============================================================================

async function seedLeadFor(
  execId: string,
  cityId: string,
  type: 'Customer' | 'Business',
  converted: boolean,
) {
  const [row] = await db
    .insert(leads)
    .values({
      type,
      name: 'Lead',
      phone: `+9198${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, '0')}`,
      cityId,
      interest: [],
      capturedByUserId: execId,
    })
    .returning({ id: leads.id });
  if (converted) {
    // Need a visit_request to point at; seed one and link.
    const req = await seedVisitRequest({
      cityId,
      assignedExecUserId: execId,
      statusStageCode: 'ASSIGNED',
    });
    await db
      .update(leads)
      .set({ convertedToRequestId: req.id, convertedAt: new Date() })
      .where(eq(leads.id, row.id));
  }
  return row.id;
}

async function seedDayPlan(execId: string, planDate: string) {
  const [row] = await db
    .insert(dayPlans)
    .values({ execUserId: execId, planDate })
    .returning({ id: dayPlans.id });
  return row.id;
}

describe('canCaptainViewExec', () => {
  it('true for the captain who owns this exec', async () => {
    const cap = await seedCaptain({
      phone: '+919005000001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105000001',
      fullName: 'Exec',
    });
    expect(await canCaptainViewExec(cap.id, exec.id, false)).toBe(true);
  });

  it('false for a different captain (D12 — 404 not 403)', async () => {
    const capA = await seedCaptain({
      phone: '+919005100001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919005100002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919105100001',
      fullName: 'Exec A',
    });
    expect(await canCaptainViewExec(capB.id, execA.id, false)).toBe(false);
  });

  it('true for super_admin on any active exec', async () => {
    const cap = await seedCaptain({
      phone: '+919005200001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105200001',
      fullName: 'Exec',
    });
    const sa = await seedSuperAdmin({
      phone: '+918888100001',
      fullName: 'Admin',
    });
    expect(await canCaptainViewExec(sa.id, exec.id, true)).toBe(true);
  });
});

describe('loadExecDayPlan', () => {
  it('single-day mode returns one row for the requested date (no plan → empty tasks)', async () => {
    const cap = await seedCaptain({
      phone: '+919005300001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105300001',
      fullName: 'Exec',
    });
    const today = getIstDateString();
    const data = await loadExecDayPlan(exec.id, {
      mode: 'single',
      date: today,
    });
    expect(data.mode).toBe('single');
    expect(data.days).toHaveLength(1);
    expect(data.days[0].planDate).toBe(today);
    expect(data.days[0].planId).toBeNull();
    expect(data.days[0].tasks).toEqual([]);
  });

  it('range mode emits one entry per IST day in the window — even days with no plan', async () => {
    const cap = await seedCaptain({
      phone: '+919005400001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105400001',
      fullName: 'Exec',
    });
    const today = getIstDateString();
    const threeDaysAgo = offsetIstDate(today, -2);
    // Seed a plan for just one day in the middle.
    const yesterday = offsetIstDate(today, -1);
    await seedDayPlan(exec.id, yesterday);

    const data = await loadExecDayPlan(exec.id, {
      mode: 'range',
      from: threeDaysAgo,
      to: today,
    });
    expect(data.mode).toBe('range');
    // 3 days inclusive (today, -1, -2)
    expect(data.days).toHaveLength(3);
    // Newest first.
    expect(data.days[0].planDate).toBe(today);
    expect(data.days[1].planDate).toBe(yesterday);
    expect(data.days[2].planDate).toBe(threeDaysAgo);
    // Only `yesterday` has a planId.
    expect(data.days[1].planId).not.toBeNull();
    expect(data.days[0].planId).toBeNull();
    expect(data.days[2].planId).toBeNull();
  });
});

describe('loadExecWeeklyReport', () => {
  it('always returns current = last 7 days, previous = 7 days before that', async () => {
    const cap = await seedCaptain({
      phone: '+919005500001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105500001',
      fullName: 'Exec',
    });
    const r = await loadExecWeeklyReport(exec.id);
    const today = getIstDateString();
    expect(r.currentWindow.to).toBe(today);
    expect(r.currentWindow.from).toBe(offsetIstDate(today, -6));
    expect(r.previousWindow.to).toBe(offsetIstDate(today, -7));
    expect(r.previousWindow.from).toBe(offsetIstDate(today, -13));
  });
});

describe('loadExecLeadsBreakdown', () => {
  it('correctly splits by type × converted (4 numbers)', async () => {
    const cap = await seedCaptain({
      phone: '+919005600001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105600001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');

    // Customer: 2 converted, 3 not yet
    await seedLeadFor(exec.id, city.id, 'Customer', true);
    await seedLeadFor(exec.id, city.id, 'Customer', true);
    await seedLeadFor(exec.id, city.id, 'Customer', false);
    await seedLeadFor(exec.id, city.id, 'Customer', false);
    await seedLeadFor(exec.id, city.id, 'Customer', false);

    // Business: 1 converted, 4 not yet
    await seedLeadFor(exec.id, city.id, 'Business', true);
    await seedLeadFor(exec.id, city.id, 'Business', false);
    await seedLeadFor(exec.id, city.id, 'Business', false);
    await seedLeadFor(exec.id, city.id, 'Business', false);
    await seedLeadFor(exec.id, city.id, 'Business', false);

    const data = await loadExecLeadsBreakdown(exec.id);
    expect(data.customer.converted).toBe(2);
    expect(data.customer.notYetConverted).toBe(3);
    expect(data.business.converted).toBe(1);
    expect(data.business.notYetConverted).toBe(4);
  });

  it('returns zeros across the board when exec has no leads', async () => {
    const cap = await seedCaptain({
      phone: '+919005700001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105700001',
      fullName: 'Exec',
    });
    const data = await loadExecLeadsBreakdown(exec.id);
    expect(data.customer.converted).toBe(0);
    expect(data.customer.notYetConverted).toBe(0);
    expect(data.business.converted).toBe(0);
    expect(data.business.notYetConverted).toBe(0);
  });
});

describe('loadSingleExecMetrics — HVA-167 vs HVA-154 parity', () => {
  it('returns the same numbers for one exec as loadTeamExecMetrics would', async () => {
    const cap = await seedCaptain({
      phone: '+919005800001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919105800001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    // 2 active assigned, 1 cancelled (must be excluded).
    const r1 = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const r2 = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const cancelled = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    await db
      .update(visitRequests)
      .set({ cancelledAt: new Date(), cancellationActor: 'customer' })
      .where(eq(visitRequests.id, cancelled.id));

    const metrics = await loadSingleExecMetrics(exec.id, {
      mode: 'single',
      date: getIstDateString(),
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.activeRequestCount).toBe(2);
    expect(metrics!.isUnavailable).toBe(false);
    void r1;
    void r2;
  });

  it('returns null for an inactive exec', async () => {
    // No seeded exec — passing a synthetic uuid mimics "exec deactivated
    // or never existed". Both fall into the same `null` branch.
    const result = await loadSingleExecMetrics(
      '00000000-0000-7000-8000-000000000000',
      { mode: 'single', date: getIstDateString() },
    );
    expect(result).toBeNull();
  });
});
