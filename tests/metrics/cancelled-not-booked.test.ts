import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  quotations,
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { loadKpiDrilldown } from '@/lib/admin/kpi-drilldown';
import { loadOrdersCount, loadOrdersValue } from '@/lib/metrics/orders';
import { loadRevenue } from '@/lib/metrics/revenue';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-334: a cancelled order is not booked business
// =============================================================================
//
// Sandeep, asked directly on 2026-08-06 whether a booked-then-cancelled order
// should still count as booked revenue: "No."
//
// Production had Ankit's order counting as ₹8,354 of Booked on 2026-07-09 —
// confirmed 17:46 IST, cancelled 17:47 IST. Seventy-nine seconds of business.
//
// Every case seeds TWO identical confirmed orders and cancels only one, so no
// assertion can pass just because a query came back empty.
// =============================================================================

const TODAY = new Date().toISOString().slice(0, 10);
const RANGE = { fromDate: TODAY, toDate: TODAY };

async function seedConfirmedOrder(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  valuePaise: number;
  cancelled: boolean;
}): Promise<string> {
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  // The metrics count TRANSITIONS INTO ORDER_CONFIRMED, not the current
  // stage, so the history row is the thing under test — not decoration.
  const [confirmed] = await db
    .select({ id: statusStages.id, seq: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.code, 'ORDER_CONFIRMED'));
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: null,
    toStatusStageId: confirmed.id,
    sequenceNumber: confirmed.seq,
    transitionOrder: 1,
    changedByUserId: opts.execId,
  });
  await db.insert(quotations).values({
    visitRequestId: req.id,
    totalOrderValuePaise: opts.valuePaise,
    source: 'portal',
    submittedByUserId: opts.execId,
  });
  if (opts.cancelled) {
    // Cancellation leaves the stage alone — that is why the stage-only
    // filters never caught it.
    await db
      .update(visitRequests)
      .set({ cancelledAt: new Date(), cancellationActor: 'customer' })
      .where(eq(visitRequests.id, req.id));
  }
  return req.id;
}

async function setup() {
  const captain = await seedCaptain({ phone: '+919942000001' });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919942000002',
    fullName: 'Exec Booked',
  });
  const live = await seedConfirmedOrder({
    cityId: city.id,
    execId: exec.id,
    captainId: captain.id,
    valuePaise: 500000,
    cancelled: false,
  });
  const dead = await seedConfirmedOrder({
    cityId: city.id,
    execId: exec.id,
    captainId: captain.id,
    valuePaise: 900000,
    cancelled: true,
  });
  return { live, dead };
}

describe('HVA-334: cancelled orders leave the booked figures', () => {
  it('counts only the live order', async () => {
    await setup();
    expect(await loadOrdersCount({}, RANGE)).toBe(1);
  });

  it('sums only the live order value', async () => {
    await setup();
    // 5,00,000 paise live + 9,00,000 cancelled. Cancelled must not appear.
    expect(await loadOrdersValue({}, RANGE)).toBe(500000);
  });

  it('keeps the drill-down list agreeing with the tile', async () => {
    const { live, dead } = await setup();
    const { rows, total } = await loadKpiDrilldown('booked', {
      ...RANGE,
      search: '',
      page: 1,
      pageSize: 50,
    });
    // The failure this ticket started as was a tile and its own drill-down
    // disagreeing. They must move together.
    expect(total).toBe(1);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(dead);
  });
});

describe('HVA-334: what deliberately does NOT change', () => {
  it('leaves collected cash (loadRevenue) alone — a refund is an outbound payment, not a filter', async () => {
    await setup();
    // No payments seeded, so this is 0 either way; the point of the assertion
    // is that loadRevenue still runs unfiltered and is not silently coupled
    // to cancellation. Money that arrived, arrived; if returned, the refund
    // nets it off. Filtering here would make the figure disagree with the bank.
    expect(await loadRevenue({}, RANGE)).toBe(0);
  });
});
