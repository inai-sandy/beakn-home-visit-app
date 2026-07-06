import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  dispatchItems,
  dispatchStatusHistory,
  dispatches,
  quotationLineItems,
  quotations,
} from '@/db/schema';
import { supportNavCountFor } from '@/lib/support/nav';
import { loadSupportNavCounts } from '@/lib/support/nav-counts';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-231 Phase 2: loadSupportNavCounts backlog badges
// =============================================================================
//
// Counts must reuse the SAME predicates as the queue pages
// (loadDispatchQueue mode=pending / in_progress, loadAllOrders), so the
// badge number matches what the support user sees on click-through.

async function seedOrderWithItem(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  productName?: string;
  qty?: number;
}): Promise<{ requestId: string; lineItemId: string }> {
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  const [q] = await db
    .insert(quotations)
    .values({
      visitRequestId: req.id,
      totalOrderValuePaise: 100000,
      source: 'portal',
      submittedByUserId: opts.execId,
    })
    .returning({ id: quotations.id });
  const [li] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: q.id,
      position: 1,
      productName: opts.productName ?? 'Test Item',
      quantity: opts.qty ?? 5,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * (opts.qty ?? 5),
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id };
}

async function dispatchSome(opts: {
  lineItemId: string;
  qty: number;
  byUserId: string;
  advanceTo?: 'packed' | 'handed_off';
}): Promise<void> {
  const [d] = await db
    .insert(dispatches)
    .values({ dispatchedByUserId: opts.byUserId })
    .returning({ id: dispatches.id });
  await db.insert(dispatchItems).values({
    dispatchId: d.id,
    quotationLineItemId: opts.lineItemId,
    qtyInThisDispatch: opts.qty,
  });
  await db.insert(dispatchStatusHistory).values({
    dispatchId: d.id,
    stage: 'created',
    changedByUserId: opts.byUserId,
  });
  if (opts.advanceTo === 'packed' || opts.advanceTo === 'handed_off') {
    await db.insert(dispatchStatusHistory).values({
      dispatchId: d.id,
      stage: 'packed',
      changedByUserId: opts.byUserId,
    });
  }
  if (opts.advanceTo === 'handed_off') {
    await db.insert(dispatchStatusHistory).values({
      dispatchId: d.id,
      stage: 'handed_off',
      changedByUserId: opts.byUserId,
    });
  }
}

describe('loadSupportNavCounts', () => {
  it('returns zeroed counts when there are no orders', async () => {
    // truncateAll runs before each test, so DB is empty here.
    const counts = await loadSupportNavCounts();
    expect(counts).toEqual({ pending: 0, inProgress: 0, orders: 0 });
  });

  it('counts pending / in-progress line items and total orders', async () => {
    const captain = await seedCaptain({ phone: '+919970000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919970000002',
      fullName: 'Exec NavCounts',
    });

    // Pending: untouched item, no dispatches.
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Pending-A',
      qty: 5,
    });

    // In-progress: partially dispatched.
    const partial = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'InProgress-A',
      qty: 5,
    });
    await dispatchSome({
      lineItemId: partial.lineItemId,
      qty: 2,
      byUserId: exec.id,
    });

    // Done: fully dispatched + handed off — not pending, not in-progress,
    // but still an order.
    const done = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Done-A',
      qty: 2,
    });
    await dispatchSome({
      lineItemId: done.lineItemId,
      qty: 2,
      byUserId: exec.id,
      advanceTo: 'handed_off',
    });

    const counts = await loadSupportNavCounts();
    expect(counts.pending).toBe(1);
    expect(counts.inProgress).toBe(1);
    // Three ORDER_CONFIRMED+ visit_requests total.
    expect(counts.orders).toBe(3);
  });
});

describe('supportNavCountFor', () => {
  const counts = { pending: 3, inProgress: 2, orders: 9 };

  it('maps each queue href to its count', () => {
    expect(supportNavCountFor('/support', counts)).toBe(3);
    expect(supportNavCountFor('/support/in-progress', counts)).toBe(2);
    expect(supportNavCountFor('/support/orders', counts)).toBe(9);
  });

  it('returns null for items without a badge (Activity) and when counts absent', () => {
    expect(supportNavCountFor('/support/activity', counts)).toBeNull();
    expect(supportNavCountFor('/support', undefined)).toBeNull();
  });
});
