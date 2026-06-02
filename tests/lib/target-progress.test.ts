import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadOneExecTargetProgress,
} from '@/lib/exec/target-progress';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// Exec target progress — calculation integrity tests
// =============================================================================
//
// Saved memory `calc-integrity-non-negotiable`: every metric query
// needs end-to-end audit + a regression test for the failure mode the
// fix prevents. The orders meter is the highest-risk query (joins
// through request_status_history which can have multiple
// ORDER_CONFIRMED rows per request on rollback+reconfirm).
// =============================================================================

const ORDER_CONFIRMED_CODE = 'ORDER_CONFIRMED';
const TARGET_PAISE = 70_000_000; // ₹7L

describe('loadAllExecTargetProgress', () => {
  let captainId: string;
  let cityId: string;
  let execAlpha: string;

  beforeAll(async () => {
    await db.delete(cities).where(sql`${cities.name} LIKE 'TARGET-%'`);
  });

  beforeEach(async () => {
    await db.update(cities).set({ captainUserId: null });

    const captain = await seedCaptain({
      phone: `+91900${Math.floor(Math.random() * 9999999)
        .toString()
        .padStart(7, '0')}`,
      fullName: 'Target Captain',
    });
    captainId = captain.id;

    const city = await getOrCreateCity('Bangalore');
    cityId = city.id;
    await db
      .update(cities)
      .set({ captainUserId: captainId })
      .where(eq(cities.id, cityId));

    const alpha = await seedExecutive(captainId, {
      phone: `+91910${Math.floor(Math.random() * 9999999)
        .toString()
        .padStart(7, '0')}`,
      fullName: 'Target Alpha',
    });
    execAlpha = alpha.id;
  });

  async function seedConfirmedOrder(args: {
    execUserId: string;
    orderValuePaise: number;
    /** When true, simulates a ROLLBACK then RE-CONFIRM in the same
     *  month: two ORDER_CONFIRMED rows in request_status_history for
     *  the same request. Should still count as one toward the target. */
    withRollback?: boolean;
  }): Promise<string> {
    const req = await seedVisitRequest({
      cityId,
      assignedExecUserId: args.execUserId,
    });
    await db.insert(quotations).values({
      visitRequestId: req.id,
      quotationNumber: `Q-${Math.random().toString(36).slice(2, 9)}`,
      totalOrderValuePaise: args.orderValuePaise,
      submittedByUserId: args.execUserId,
    });

    // Pull the ORDER_CONFIRMED stage so we can write the history row.
    const [confirmedStage] = await db
      .select({ id: statusStages.id, seq: statusStages.sequenceNumber })
      .from(statusStages)
      .where(eq(statusStages.code, ORDER_CONFIRMED_CODE))
      .limit(1);

    if (!confirmedStage) throw new Error('ORDER_CONFIRMED stage missing');

    // First confirmation.
    await db.insert(requestStatusHistory).values({
      requestId: req.id,
      fromStatusStageId: confirmedStage.id,
      toStatusStageId: confirmedStage.id,
      sequenceNumber: confirmedStage.seq,
      transitionOrder: 1,
      changedByUserId: args.execUserId,
      reason: 'First confirmation',
    });

    if (args.withRollback) {
      // Simulated rollback + re-confirm — second ORDER_CONFIRMED row.
      await db.insert(requestStatusHistory).values({
        requestId: req.id,
        fromStatusStageId: confirmedStage.id,
        toStatusStageId: confirmedStage.id,
        sequenceNumber: confirmedStage.seq,
        transitionOrder: 2,
        changedByUserId: args.execUserId,
        reason: 'Re-confirmed after rollback',
      });
    }

    return req.id;
  }

  it('sums confirmed orders correctly (happy path)', async () => {
    await seedConfirmedOrder({
      execUserId: execAlpha,
      orderValuePaise: 200_000_00, // ₹2L
    });
    await seedConfirmedOrder({
      execUserId: execAlpha,
      orderValuePaise: 300_000_00, // ₹3L
    });

    const rows = await loadAllExecTargetProgress(
      getCurrentMonthWindow(),
      TARGET_PAISE,
      { captainUserId: captainId },
    );
    const alpha = rows.find((r) => r.execUserId === execAlpha);
    expect(alpha).toBeDefined();
    expect(alpha?.ordersPaise).toBe(500_000_00); // ₹2L + ₹3L = ₹5L
  });

  it('REGRESSION: rollback + re-confirm in the same month does NOT double-count the order value', async () => {
    // Single request worth ₹4L; the status history has TWO ORDER_CONFIRMED
    // rows because the request was rolled back and re-confirmed. Without
    // the DISTINCT request_id subquery the JOIN to quotations would
    // produce 2 rows × ₹4L = ₹8L. The fix collapses it to ₹4L.
    await seedConfirmedOrder({
      execUserId: execAlpha,
      orderValuePaise: 400_000_00, // ₹4L
      withRollback: true,
    });

    const rows = await loadAllExecTargetProgress(
      getCurrentMonthWindow(),
      TARGET_PAISE,
      { captainUserId: captainId },
    );
    const alpha = rows.find((r) => r.execUserId === execAlpha);
    expect(alpha?.ordersPaise).toBe(400_000_00); // NOT 800_000_00
  });

  it('REGRESSION: same rollback-de-dupe holds in the single-exec narrow path', async () => {
    await seedConfirmedOrder({
      execUserId: execAlpha,
      orderValuePaise: 250_000_00, // ₹2.5L
      withRollback: true,
    });

    const progress = await loadOneExecTargetProgress(
      execAlpha,
      getCurrentMonthWindow(),
      TARGET_PAISE,
    );
    expect(progress?.ordersPaise).toBe(250_000_00);
  });

  it('attributes revenue via visit_requests.assigned_exec_user_id, not payments.recorded_by_user_id', async () => {
    const reqId = await seedConfirmedOrder({
      execUserId: execAlpha,
      orderValuePaise: 100_000_00,
    });

    // Payment recorded by the captain (action-taker), but the request
    // is assigned to execAlpha (deal-owner). Credit must follow the
    // exec, NOT the captain — the attribution principle.
    await db.insert(payments).values({
      visitRequestId: reqId,
      direction: 'inbound',
      amountPaise: 150_000_00,
      paymentDate: getCurrentMonthWindow().monthStart,
      mode: 'Cash',
      recordedByUserId: captainId,
    });

    const rows = await loadAllExecTargetProgress(
      getCurrentMonthWindow(),
      TARGET_PAISE,
      { captainUserId: captainId },
    );
    const alpha = rows.find((r) => r.execUserId === execAlpha);
    expect(alpha?.revenuePaise).toBe(150_000_00);
    // Captain doesn't appear in the rows at all (they're not an exec).
    expect(rows.find((r) => r.execUserId === captainId)).toBeUndefined();
  });

  it('returns a row for every active exec, including zero-activity', async () => {
    // No data seeded for execAlpha — they should still appear in the
    // results with zeros so the captain/admin arena shows a complete
    // roster.
    const rows = await loadAllExecTargetProgress(
      getCurrentMonthWindow(),
      TARGET_PAISE,
      { captainUserId: captainId },
    );
    const alpha = rows.find((r) => r.execUserId === execAlpha);
    expect(alpha).toBeDefined();
    expect(alpha?.ordersPaise).toBe(0);
    expect(alpha?.revenuePaise).toBe(0);
    expect(alpha?.ordersRatio).toBe(0);
    expect(alpha?.revenueRatio).toBe(0);
  });
});
