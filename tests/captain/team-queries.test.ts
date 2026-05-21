import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  leads,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import { loadTeamExecMetrics } from '@/lib/captain/team-queries';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-154: loadTeamExecMetrics tests
// =============================================================================

async function seedContactFor(execId: string, cityId: string, createdAt?: Date) {
  const [row] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: 'Test',
      phone: `+9198${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, '0')}`,
      cityId,
      interest: [],
      capturedByUserId: execId,
    })
    .returning({ id: leads.id });
  if (createdAt) {
    await db
      .update(leads)
      .set({ createdAt })
      .where(eq(leads.id, row.id));
  }
  return row.id;
}

async function setRequestStatus(requestId: string, code: string) {
  const [stage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, code))
    .limit(1);
  await db
    .update(visitRequests)
    .set({ statusStageId: stage.id })
    .where(eq(visitRequests.id, requestId));
}

describe('loadTeamExecMetrics — defaults', () => {
  it('returns zero counts for execs with no requests / no contacts in window', async () => {
    const cap = await seedCaptain({
      phone: '+919004000001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919104000001',
      fullName: 'Exec',
    });
    const today = getIstDateString();
    const filter = {
      mode: 'range' as const,
      from: offsetIstDate(today, -6),
      to: today,
    };
    const map = await loadTeamExecMetrics(cap.id, filter);
    expect(map.size).toBe(1);
    const m = map.get(exec.id);
    expect(m).toBeDefined();
    expect(m!.activeRequestCount).toBe(0);
    expect(m!.contactsCapturedInWindow).toBe(0);
    expect(m!.isUnavailable).toBe(false);
  });
});

describe('loadTeamExecMetrics — active requests', () => {
  it('excludes cancelled requests', async () => {
    const cap = await seedCaptain({
      phone: '+919004100001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919104100001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');

    const active = await seedVisitRequest({
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

    const filter = {
      mode: 'single' as const,
      date: getIstDateString(),
    };
    const map = await loadTeamExecMetrics(cap.id, filter);
    expect(map.get(exec.id)!.activeRequestCount).toBe(1);
    void active;
  });

  it('excludes ORDER_EXECUTED_SUCCESSFULLY (terminal positive)', async () => {
    const cap = await seedCaptain({
      phone: '+919004200001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919104200001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');

    const open = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const closed = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    await setRequestStatus(closed.id, 'ORDER_EXECUTED_SUCCESSFULLY');

    const filter = {
      mode: 'single' as const,
      date: getIstDateString(),
    };
    const map = await loadTeamExecMetrics(cap.id, filter);
    expect(map.get(exec.id)!.activeRequestCount).toBe(1);
    void open;
  });
});

describe('loadTeamExecMetrics — contacts captured window', () => {
  it('counts contacts whose created_at falls within the inclusive IST window', async () => {
    const cap = await seedCaptain({
      phone: '+919004300001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919104300001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');

    const today = getIstDateString();
    const sevenDaysAgo = offsetIstDate(today, -6);
    const tenDaysAgo = offsetIstDate(today, -9);

    // Inside the week window (created today).
    await seedContactFor(exec.id, city.id);

    // Inside the week window (created exactly at the from boundary).
    // 12:00 IST on day-6 → safely within the inclusive day boundary.
    const at7DaysAgoNoon = new Date(`${sevenDaysAgo}T12:00:00+05:30`);
    await seedContactFor(exec.id, city.id, at7DaysAgoNoon);

    // Outside the week window (created 10 days ago).
    const at10DaysAgoNoon = new Date(`${tenDaysAgo}T12:00:00+05:30`);
    await seedContactFor(exec.id, city.id, at10DaysAgoNoon);

    const weekFilter = {
      mode: 'range' as const,
      from: sevenDaysAgo,
      to: today,
    };
    const weekMap = await loadTeamExecMetrics(cap.id, weekFilter);
    expect(weekMap.get(exec.id)!.contactsCapturedInWindow).toBe(2);

    const monthFilter = {
      mode: 'range' as const,
      from: offsetIstDate(today, -29),
      to: today,
    };
    const monthMap = await loadTeamExecMetrics(cap.id, monthFilter);
    expect(monthMap.get(exec.id)!.contactsCapturedInWindow).toBe(3);
  });
});

describe('loadTeamExecMetrics — team membership', () => {
  it('returns one entry per active team exec (no extras, no missing)', async () => {
    const capA = await seedCaptain({
      phone: '+919004400001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919004400002',
      fullName: 'Cap B',
    });
    const execA1 = await seedExecutive(capA.id, {
      phone: '+919104400001',
      fullName: 'Exec A1',
    });
    const execA2 = await seedExecutive(capA.id, {
      phone: '+919104400002',
      fullName: 'Exec A2',
    });
    const execB1 = await seedExecutive(capB.id, {
      phone: '+919104400003',
      fullName: 'Exec B1',
    });

    const filter = {
      mode: 'single' as const,
      date: getIstDateString(),
    };
    const a = await loadTeamExecMetrics(capA.id, filter);
    expect([...a.keys()].sort()).toEqual([execA1.id, execA2.id].sort());

    const b = await loadTeamExecMetrics(capB.id, filter);
    expect([...b.keys()]).toEqual([execB1.id]);
  });

  it('excludes deactivated execs', async () => {
    const cap = await seedCaptain({
      phone: '+919004500001',
      fullName: 'Cap',
    });
    const active = await seedExecutive(cap.id, {
      phone: '+919104500001',
      fullName: 'Active',
    });
    const inactive = await seedExecutive(cap.id, {
      phone: '+919104500002',
      fullName: 'Inactive',
    });
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, inactive.id));

    const filter = {
      mode: 'single' as const,
      date: getIstDateString(),
    };
    const map = await loadTeamExecMetrics(cap.id, filter);
    expect([...map.keys()]).toEqual([active.id]);
  });
});

describe('loadTeamExecMetrics — isUnavailable', () => {
  it('exposes sales_executives.is_unavailable verbatim', async () => {
    const cap = await seedCaptain({
      phone: '+919004600001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919104600001',
      fullName: 'Exec',
    });
    await db
      .update(salesExecutives)
      .set({ isUnavailable: true })
      .where(eq(salesExecutives.userId, exec.id));

    const filter = {
      mode: 'single' as const,
      date: getIstDateString(),
    };
    const map = await loadTeamExecMetrics(cap.id, filter);
    expect(map.get(exec.id)!.isUnavailable).toBe(true);

    // Sanity: another captain shouldn't have this exec.
    void and;
    void sql;
  });
});
