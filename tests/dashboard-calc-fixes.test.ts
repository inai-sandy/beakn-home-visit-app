import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { payments, quotations, requestStatusHistory } from '@/db/schema';
import { loadTeamExecStatuses } from '@/lib/captain/dashboard-queries';
import { loadMetrics } from '@/lib/metrics/registry';
import { singleDayRange } from '@/lib/metrics/types';
import { loadFinancialMetricsForDate } from '@/lib/today/metrics';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from './helpers/db';

// =============================================================================
// HVA-276: dashboard calc fixes — regression tests
// =============================================================================
//
// Each test reproduces a failure mode found in the HVA-275 number-map
// audit. Per calc-integrity-non-negotiable, the test names state the
// OLD wrong behaviour so a future regression is recognisable from the
// failure output alone.
// =============================================================================

const istToday = getIstDateString();

function istYesterday(): string {
  const [y, m, d] = istToday.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Timestamp for an IST wall-clock moment on a given IST date. */
function atIst(istDate: string, hhmm: string): Date {
  return new Date(`${istDate}T${hhmm}:00+05:30`);
}

async function seedTeam(suffix: string) {
  const captain = await seedCaptain({ phone: `+9190009${suffix}` });
  const city = await getOrCreateCity('Hyderabad');
  const exec = await seedExecutive(captain.id, { phone: `+9191009${suffix}` });
  return { captain, city, exec };
}

async function insertTransition(args: {
  requestId: string;
  toCode: string;
  byUserId: string;
  changedAt?: Date;
  transitionOrder: number;
}) {
  const from = await getStatusStage('SUBMITTED');
  const to = await getStatusStage(args.toCode);
  await db.insert(requestStatusHistory).values({
    requestId: args.requestId,
    fromStatusStageId: from.id,
    toStatusStageId: to.id,
    sequenceNumber: to.sequenceNumber,
    transitionOrder: args.transitionOrder,
    changedByUserId: args.byUserId,
    ...(args.changedAt ? { changedAt: args.changedAt } : {}),
  });
}

describe('F1: conversion_pct = orders ÷ visited requests (was: ÷ visit tasks, could exceed 100%)', () => {
  it('orders with zero completed-visit requests give null, not 200%', async () => {
    const { city, exec } = await seedTeam('00001');

    // Two confirmed orders today, NO request ever entered VISIT_COMPLETED.
    for (let i = 0; i < 2; i++) {
      const req = await seedVisitRequest({
        cityId: city.id,
        assignedExecUserId: exec.id,
        statusStageCode: 'SUBMITTED',
      });
      await insertTransition({
        requestId: req.id,
        toCode: 'ORDER_CONFIRMED',
        byUserId: exec.id,
        transitionOrder: 1,
      });
    }

    const m = await loadMetrics(
      ['orders_count', 'conversion_pct'],
      { execUserId: exec.id },
      singleDayRange(istToday),
    );
    expect(m.orders_count).toBe(2);
    // Old formula divided by completed visit TASKS — with one ticked
    // task this read 200%. New denominator is visited requests: none
    // completed a visit, so the ratio is undefined.
    expect(m.conversion_pct).toBeNull();
  });

  it('2 requests visited, 1 confirmed → 50%', async () => {
    const { city, exec } = await seedTeam('00002');

    const reqA = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'SUBMITTED',
    });
    const reqB = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'SUBMITTED',
    });
    await insertTransition({
      requestId: reqA.id,
      toCode: 'VISIT_COMPLETED',
      byUserId: exec.id,
      transitionOrder: 1,
    });
    await insertTransition({
      requestId: reqB.id,
      toCode: 'VISIT_COMPLETED',
      byUserId: exec.id,
      transitionOrder: 1,
    });
    await insertTransition({
      requestId: reqA.id,
      toCode: 'ORDER_CONFIRMED',
      byUserId: exec.id,
      transitionOrder: 2,
    });

    const m = await loadMetrics(
      ['conversion_pct'],
      { execUserId: exec.id },
      singleDayRange(istToday),
    );
    expect(m.conversion_pct).toBe(50);
  });
});

describe('F4: exec day-close orders count ORDER_CONFIRMED only (was: + ORDER_EXECUTED, one request = an order on two days)', () => {
  it('the execution day shows 0 orders when the confirm happened yesterday', async () => {
    const { city, exec } = await seedTeam('00003');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'SUBMITTED',
    });

    await insertTransition({
      requestId: req.id,
      toCode: 'ORDER_CONFIRMED',
      byUserId: exec.id,
      changedAt: atIst(istYesterday(), '15:00'),
      transitionOrder: 1,
    });
    await insertTransition({
      requestId: req.id,
      toCode: 'ORDER_EXECUTED_SUCCESSFULLY',
      byUserId: exec.id,
      changedAt: atIst(istToday, '11:00'),
      transitionOrder: 2,
    });

    const yesterday = await loadFinancialMetricsForDate({
      execUserId: exec.id,
      istDateStr: istYesterday(),
    });
    const today = await loadFinancialMetricsForDate({
      execUserId: exec.id,
      istDateStr: istToday,
    });

    expect(yesterday.targets.orders.actual).toBe(1);
    // Old union counted the execution as a SECOND order today.
    expect(today.targets.orders.actual).toBe(0);
  });
});

describe('F3: IST wrap on day-close date casts (was: bare ::date used the UTC calendar)', () => {
  it('a 12:30 AM IST order counts on the IST day, not the previous day', async () => {
    const { city, exec } = await seedTeam('00004');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'SUBMITTED',
    });

    // 00:30 IST today = 19:00 UTC YESTERDAY — the old bare ::date cast
    // filed this under yesterday.
    await insertTransition({
      requestId: req.id,
      toCode: 'ORDER_CONFIRMED',
      byUserId: exec.id,
      changedAt: atIst(istToday, '00:30'),
      transitionOrder: 1,
    });
    await db.insert(quotations).values({
      visitRequestId: req.id,
      totalOrderValuePaise: 500_00,
      submittedByUserId: exec.id,
      submittedAt: atIst(istToday, '00:30'),
    });

    const today = await loadFinancialMetricsForDate({
      execUserId: exec.id,
      istDateStr: istToday,
    });
    const yesterday = await loadFinancialMetricsForDate({
      execUserId: exec.id,
      istDateStr: istYesterday(),
    });

    expect(today.targets.orders.actual).toBe(1);
    expect(today.quotationsCount).toBe(1);
    expect(yesterday.targets.orders.actual).toBe(0);
    expect(yesterday.quotationsCount).toBe(0);
  });
});

describe('F2: per-exec collections are net of refunds (was: inbound only, rows summed above the team Revenue card)', () => {
  it('₹500 in + ₹200 refund shows ₹300, matching the team Revenue formula', async () => {
    const { captain, city, exec } = await seedTeam('00005');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'SUBMITTED',
    });

    await db.insert(payments).values([
      {
        visitRequestId: req.id,
        direction: 'inbound',
        amountPaise: 500_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: exec.id,
      },
      {
        visitRequestId: req.id,
        direction: 'outbound',
        amountPaise: 200_00,
        paymentDate: istToday,
        mode: 'UPI',
        recordedByUserId: exec.id,
      },
    ]);

    const statuses = await loadTeamExecStatuses(captain.id, {
      mode: 'single',
      date: istToday,
    });
    const row = statuses.find((s) => s.userId === exec.id);
    expect(row).toBeDefined();
    // Old inbound-only sum reported ₹500 here while the team Revenue
    // card said ₹300 for the same exec on the same screen.
    expect(row!.collectionsTodayRupees).toBe(300);

    // The team Revenue SSOT loader agrees by construction.
    const m = await loadMetrics(
      ['revenue'],
      { captainUserId: captain.id },
      singleDayRange(istToday),
    );
    expect(m.revenue).toBe(300_00);
  });
});
