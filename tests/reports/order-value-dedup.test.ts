import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { quotations, requestStatusHistory } from '@/db/schema';
import { reportCityOrders } from '@/lib/reports/geography';
import { reportOrderValueTrend } from '@/lib/reports/sales';
import { reportExecOrders } from '@/lib/reports/team';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// F2 — HVA-281 regression: order-value double-count on rollback + re-confirm
// =============================================================================
//
// A request that reaches ORDER_CONFIRMED, gets rolled back, then
// re-confirmed has TWO `request_status_history` rows with
// to_status_stage_id = ORDER_CONFIRMED inside the same report window.
// The 1:1 quotation was joined per history row, so pre-fix SUM summed the
// order's value once per row (double-counted). The fix keeps only the
// LATEST ORDER_CONFIRMED row per request via a NOT EXISTS self-join, so
// the value is summed exactly once regardless of how many times the
// request bounced through confirmation.
//
// Covered here: reportOrderValueTrend (lib/reports/sales.ts),
// reportExecOrders (lib/reports/team.ts), reportCityOrders
// (lib/reports/geography.ts) — all three touched by the same fix.
// =============================================================================

const istToday = getIstDateString();
const ORDER_VALUE_PAISE = 100_000; // ₹1,000

async function seedRolledBackAndReconfirmedOrder(args: {
  cityId: string;
  execUserId: string;
  captainUserId: string;
}): Promise<{ requestId: string }> {
  const req = await seedVisitRequest({
    cityId: args.cityId,
    assignedExecUserId: args.execUserId,
    assignedCaptainUserId: args.captainUserId,
  });
  await db.insert(quotations).values({
    visitRequestId: req.id,
    quotationNumber: `Q-${Math.random().toString(36).slice(2, 9)}`,
    totalOrderValuePaise: ORDER_VALUE_PAISE,
    source: 'portal',
    submittedByUserId: args.execUserId,
  });

  const confirmed = await getStatusStage('ORDER_CONFIRMED');

  // First confirmation.
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: confirmed.id,
    toStatusStageId: confirmed.id,
    sequenceNumber: confirmed.sequenceNumber,
    transitionOrder: 1,
    changedByUserId: args.execUserId,
    reason: 'First confirmation',
    // Force an explicit ordering — changedAt defaults to now(), so
    // stamp the first row slightly earlier than the second.
    changedAt: new Date(Date.now() - 60_000),
  });

  // Rollback + re-confirm — second ORDER_CONFIRMED row for the SAME
  // request, both inside the report window.
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: confirmed.id,
    toStatusStageId: confirmed.id,
    sequenceNumber: confirmed.sequenceNumber,
    transitionOrder: 2,
    changedByUserId: args.execUserId,
    reason: 'Re-confirmed after rollback',
    changedAt: new Date(),
  });

  return { requestId: req.id };
}

describe('reportOrderValueTrend — rollback + re-confirm dedup (lib/reports/sales.ts)', () => {
  it('REGRESSION: sums the order value once, not once per ORDER_CONFIRMED history row', async () => {
    const captain = await seedCaptain({ phone: '+919300000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919300000002',
      fullName: 'Exec Dedup Sales',
    });

    await seedRolledBackAndReconfirmedOrder({
      cityId: city.id,
      execUserId: exec.id,
      captainUserId: captain.id,
    });

    const result = await reportOrderValueTrend({
      scope: { kind: 'global' },
      range: { fromDate: istToday, toDate: istToday },
      bucket: 'day',
    });

    const totalValue = result.rows.reduce((s, r) => s + r.value, 0);
    const totalCount = result.rows.reduce((s, r) => s + r.count, 0);
    expect(totalValue).toBe(ORDER_VALUE_PAISE); // NOT 200_000
    expect(totalCount).toBe(1); // one distinct request
  });
});

describe('reportExecOrders — rollback + re-confirm dedup (lib/reports/team.ts)', () => {
  it('REGRESSION: per-exec order value is not double-counted', async () => {
    const captain = await seedCaptain({ phone: '+919300000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919300000011',
      fullName: 'Exec Dedup Team',
    });

    await seedRolledBackAndReconfirmedOrder({
      cityId: city.id,
      execUserId: exec.id,
      captainUserId: captain.id,
    });

    const result = await reportExecOrders({
      scope: { kind: 'captain', captainUserId: captain.id },
      range: { fromDate: istToday, toDate: istToday },
    });

    const row = result.rows.find((r) => r.execUserId === exec.id);
    expect(row).toBeDefined();
    expect(row?.orderValuePaise).toBe(ORDER_VALUE_PAISE); // NOT 200_000
    expect(row?.ordersCount).toBe(1);
  });
});

describe('reportCityOrders — rollback + re-confirm dedup (lib/reports/geography.ts)', () => {
  it('REGRESSION: per-city order value is not double-counted', async () => {
    const captain = await seedCaptain({ phone: '+919300000020' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919300000021',
      fullName: 'Exec Dedup Geo',
    });

    await seedRolledBackAndReconfirmedOrder({
      cityId: city.id,
      execUserId: exec.id,
      captainUserId: captain.id,
    });

    const result = await reportCityOrders({
      scope: { kind: 'global' },
      range: { fromDate: istToday, toDate: istToday },
    });

    const row = result.rows.find((r) => r.cityName === 'Bangalore');
    expect(row).toBeDefined();
    expect(row?.orderValuePaise).toBe(ORDER_VALUE_PAISE); // NOT 200_000
    expect(row?.ordersCount).toBe(1);
  });
});
