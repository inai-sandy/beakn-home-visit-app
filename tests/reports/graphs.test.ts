import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  requestStatusHistory,
  salesExecutives,
  visitRequests,
} from '@/db/schema';
import {
  buildDayBuckets,
  graphCityShare,
  graphConversionTrend,
  graphRevenueTrend,
  graphStatusFunnel,
  graphTopExecsByOrders,
  graphVisitsOrdersByDay,
  loadGraphsBundle,
} from '@/lib/reports/graphs';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// /reports/graphs — data layer tests (HVA-226)
// =============================================================================
//
// Verifies the 6 graph loaders match the same SSOT discipline used by
// lib/reports/sales.ts:
//   * net cash (inbound − outbound) on revenue
//   * DISTINCT request_id on status_history joins
//   * attribution via assigned_exec_user_id
//   * exec scope returns only the caller's request data
//   * empty windows return zero-filled day series
// =============================================================================

const istToday = getIstDateString();

beforeEach(async () => {
  await getOrCreateCity('Bangalore');
});

describe('buildDayBuckets', () => {
  it('returns every IST day in the inclusive range', () => {
    const days = buildDayBuckets({
      fromDate: '2026-01-01',
      toDate: '2026-01-05',
    });
    expect(days).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
    ]);
  });

  it('returns a single day when fromDate === toDate', () => {
    const days = buildDayBuckets({
      fromDate: '2026-06-04',
      toDate: '2026-06-04',
    });
    expect(days).toEqual(['2026-06-04']);
  });

  // HVA-227 — every chart now honors a user-supplied date range. The
  // loader must zero-fill the full custom window even when it's wider
  // or narrower than the default 30 days.
  it('zero-fills a custom 7-day window for graphRevenueTrend', async () => {
    const fromDate = shiftDateString(istToday, -6);
    const range = { fromDate, toDate: istToday };
    const rows = await graphRevenueTrend({
      scope: { kind: 'global' },
      range,
    });
    expect(rows).toHaveLength(7);
    expect(rows[0].day).toBe(fromDate);
    expect(rows[rows.length - 1].day).toBe(istToday);
  });

  it('zero-fills a custom 90-day window for graphRevenueTrend', async () => {
    const fromDate = shiftDateString(istToday, -89);
    const range = { fromDate, toDate: istToday };
    const rows = await graphRevenueTrend({
      scope: { kind: 'global' },
      range,
    });
    expect(rows).toHaveLength(90);
  });
});

function shiftDateString(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

describe('graphRevenueTrend', () => {
  it('zero-fills days with no payments', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphRevenueTrend({ scope: { kind: 'global' }, range });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ day: istToday, value: 0 });
  });

  it('sums inbound − outbound per IST day (net cash)', async () => {
    const captain = await seedCaptain({ phone: '+919200000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919200000002',
      fullName: 'Exec Revenue',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });

    await db.insert(payments).values([
      {
        visitRequestId: req.id,
        direction: 'inbound',
        amountPaise: 100_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: exec.id,
      },
      {
        visitRequestId: req.id,
        direction: 'outbound',
        amountPaise: 30_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: exec.id,
      },
    ]);

    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphRevenueTrend({ scope: { kind: 'global' }, range });
    const today = rows.find((r) => r.day === istToday);
    expect(today?.value).toBe(70_00); // 100 inbound − 30 outbound (paise)
  });
});

describe('graphVisitsOrdersByDay', () => {
  it('returns 0/0 for an empty window with day series', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphVisitsOrdersByDay({
      scope: { kind: 'global' },
      range,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ day: istToday, a: 0, b: 0 });
  });

  it('counts distinct requests reaching VISIT_COMPLETED and ORDER_CONFIRMED', async () => {
    const captain = await seedCaptain({ phone: '+919200000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919200000011',
      fullName: 'Exec VO',
    });
    const submitted = await getStatusStage('SUBMITTED');
    const visitDone = await getStatusStage('VISIT_COMPLETED');
    const orderConfirmed = await getStatusStage('ORDER_CONFIRMED');

    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });

    // Two transitions for the SAME request — DISTINCT request_id must
    // count once per stage.
    await db.insert(requestStatusHistory).values([
      {
        requestId: req.id,
        fromStatusStageId: submitted.id,
        toStatusStageId: visitDone.id,
        sequenceNumber: visitDone.sequenceNumber,
        transitionOrder: 1,
        changedByUserId: exec.id,
      },
      {
        requestId: req.id,
        fromStatusStageId: visitDone.id,
        toStatusStageId: orderConfirmed.id,
        sequenceNumber: orderConfirmed.sequenceNumber,
        transitionOrder: 2,
        changedByUserId: exec.id,
      },
    ]);

    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphVisitsOrdersByDay({
      scope: { kind: 'global' },
      range,
    });
    const today = rows.find((r) => r.day === istToday);
    expect(today?.a).toBe(1); // visits
    expect(today?.b).toBe(1); // orders
  });
});

describe('graphStatusFunnel', () => {
  it('returns one row per active stage even when empty', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphStatusFunnel({ scope: { kind: 'global' }, range });
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.every((r) => r.requestsReached === 0)).toBe(true);
  });
});

describe('graphCityShare', () => {
  it('omits cities with zero revenue', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphCityShare({ scope: { kind: 'global' }, range });
    expect(rows.every((r) => r.revenuePaise > 0)).toBe(true);
  });

  it('aggregates net cash by city', async () => {
    const captain = await seedCaptain({ phone: '+919200000020' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919200000021',
      fullName: 'Exec City',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });

    await db.insert(payments).values({
      visitRequestId: req.id,
      direction: 'inbound',
      amountPaise: 1_000_00,
      paymentDate: istToday,
      mode: 'UPI',
      recordedByUserId: exec.id,
    });

    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphCityShare({ scope: { kind: 'global' }, range });
    const blr = rows.find((r) => r.cityName === 'Bangalore');
    expect(blr?.revenuePaise).toBe(1_000_00);
  });
});

describe('graphTopExecsByOrders', () => {
  it('returns the empty list when no orders confirmed', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphTopExecsByOrders({
      scope: { kind: 'global' },
      range,
    });
    expect(rows).toEqual([]);
  });

  it('attributes orders to the assigned exec (not the action-taker)', async () => {
    const captain = await seedCaptain({ phone: '+919200000030' });
    const city = await getOrCreateCity('Bangalore');
    const execA = await seedExecutive(captain.id, {
      phone: '+919200000031',
      fullName: 'Exec Alpha',
    });
    const execB = await seedExecutive(captain.id, {
      phone: '+919200000032',
      fullName: 'Exec Bravo',
    });

    const submitted = await getStatusStage('SUBMITTED');
    const confirmed = await getStatusStage('ORDER_CONFIRMED');

    // Request assigned to ExecA, but the transition was clicked by
    // captain (attribution should follow assigned_exec, not changedBy).
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      assignedCaptainUserId: captain.id,
    });
    await db.insert(requestStatusHistory).values({
      requestId: req.id,
      fromStatusStageId: submitted.id,
      toStatusStageId: confirmed.id,
      sequenceNumber: confirmed.sequenceNumber,
      transitionOrder: 1,
      changedByUserId: captain.id, // captain clicked
    });

    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphTopExecsByOrders({
      scope: { kind: 'global' },
      range,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].execUserId).toBe(execA.id); // assigned, not clicker
    expect(rows[0].ordersConfirmed).toBe(1);
    // ExecB should not appear.
    expect(rows.find((r) => r.execUserId === execB.id)).toBeUndefined();
  });
});

describe('graphConversionTrend', () => {
  it('zero-fills days with no transitions', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const rows = await graphConversionTrend({
      scope: { kind: 'global' },
      range,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      day: istToday,
      conversionPct: 0,
      ordersCount: 0,
      quotationsCount: 0,
    });
  });
});

describe('loadGraphsBundle', () => {
  it('returns all 6 series in one call', async () => {
    const range = { fromDate: istToday, toDate: istToday };
    const bundle = await loadGraphsBundle({
      scope: { kind: 'global' },
      range,
    });
    expect(bundle).toHaveProperty('revenue');
    expect(bundle).toHaveProperty('visitsOrders');
    expect(bundle).toHaveProperty('funnel');
    expect(bundle).toHaveProperty('cityShare');
    expect(bundle).toHaveProperty('topExecs');
    expect(bundle).toHaveProperty('conversion');
  });

  it('exec scope only sees the exec own requests', async () => {
    const captain = await seedCaptain({ phone: '+919200000040' });
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: captain.id })
      .where(eq(cities.id, city.id));
    const execA = await seedExecutive(captain.id, {
      phone: '+919200000041',
      fullName: 'Exec Own',
    });
    const execB = await seedExecutive(captain.id, {
      phone: '+919200000042',
      fullName: 'Exec Other',
    });
    await db
      .update(salesExecutives)
      .set({ cityId: city.id })
      .where(eq(salesExecutives.userId, execA.id));
    await db
      .update(salesExecutives)
      .set({ cityId: city.id })
      .where(eq(salesExecutives.userId, execB.id));

    const reqA = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      assignedCaptainUserId: captain.id,
    });
    const reqB = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id,
      assignedCaptainUserId: captain.id,
    });

    await db.insert(payments).values([
      {
        visitRequestId: reqA.id,
        direction: 'inbound',
        amountPaise: 500_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: execA.id,
      },
      {
        visitRequestId: reqB.id,
        direction: 'inbound',
        amountPaise: 900_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: execB.id,
      },
    ]);

    const range = { fromDate: istToday, toDate: istToday };
    const own = await loadGraphsBundle({
      scope: { kind: 'exec', execUserId: execA.id },
      range,
    });
    const totalOwn = own.revenue.reduce((s, r) => s + r.value, 0);
    expect(totalOwn).toBe(500_00); // execA's payments only

    const global = await loadGraphsBundle({
      scope: { kind: 'global' },
      range,
    });
    const totalGlobal = global.revenue.reduce((s, r) => s + r.value, 0);
    expect(totalGlobal).toBe(1_400_00); // both execs
  });
});
