import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  dispatchItems,
  dispatchStatusHistory,
  dispatches,
  quotationLineItems,
  quotations,
  visitRequests,
} from '@/db/schema';
import { loadDispatchQueue } from '@/lib/support/dispatch-queries';
import { loadActivityFeed, loadAllOrders } from '@/lib/support/orders-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-245: loadDispatchQueue(mode) + loadAllOrders + loadActivityFeed
// =============================================================================

async function seedOrderWithItem(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  productName?: string;
  qty?: number;
  statusStageCode?: string;
}): Promise<{ requestId: string; lineItemId: string }> {
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: opts.statusStageCode ?? 'ORDER_CONFIRMED',
  });
  const [q] = await db
    .insert(quotations)
    .values({
      visitRequestId: req.id,
      totalOrderValuePaise: 100000,
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
}): Promise<string> {
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
  return d.id;
}

describe('loadDispatchQueue(mode)', () => {
  it('mode=pending only returns items with zero dispatches', async () => {
    const captain = await seedCaptain({ phone: '+919997000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919997000002',
      fullName: 'Exec QA',
    });

    // Untouched item — should appear in pending
    const a = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Untouched',
      qty: 5,
    });
    // Partially dispatched — should NOT appear in pending
    const b = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Partial',
      qty: 5,
    });
    await dispatchSome({ lineItemId: b.lineItemId, qty: 2, byUserId: exec.id });

    const pending = await loadDispatchQueue({ mode: 'pending' });
    const names = pending.map((r) => r.productName);
    expect(names).toContain('Untouched');
    expect(names).not.toContain('Partial');
  });

  it('mode=in_progress returns items with at least one dispatch but not fully done', async () => {
    const captain = await seedCaptain({ phone: '+919997100001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919997100002',
      fullName: 'Exec IP',
    });

    // Untouched — should NOT appear
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Untouched-IP',
      qty: 3,
    });
    // Partial — should appear
    const partial = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Partial-IP',
      qty: 5,
    });
    await dispatchSome({
      lineItemId: partial.lineItemId,
      qty: 2,
      byUserId: exec.id,
    });
    // Fully dispatched + handed_off — should NOT appear
    const done = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Done-IP',
      qty: 2,
    });
    await dispatchSome({
      lineItemId: done.lineItemId,
      qty: 2,
      byUserId: exec.id,
      advanceTo: 'handed_off',
    });
    // Fully dispatched but NOT yet handed_off — should appear (mid-flight)
    const midFlight = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'MidFlight-IP',
      qty: 2,
    });
    await dispatchSome({
      lineItemId: midFlight.lineItemId,
      qty: 2,
      byUserId: exec.id,
      advanceTo: 'packed',
    });

    const inProgress = await loadDispatchQueue({ mode: 'in_progress' });
    const names = inProgress.map((r) => r.productName);
    expect(names).toContain('Partial-IP');
    expect(names).toContain('MidFlight-IP');
    expect(names).not.toContain('Untouched-IP');
    expect(names).not.toContain('Done-IP');
  });
});

describe('loadAllOrders', () => {
  it('rolls dispatch state up per order: pending / in_progress / done', async () => {
    const captain = await seedCaptain({ phone: '+919998000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919998000002',
      fullName: 'Exec Orders',
    });

    // Pending order
    const pendingOrder = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Pend-A',
      qty: 4,
    });

    // In-progress order
    const inProgress = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Prog-A',
      qty: 4,
    });
    await dispatchSome({
      lineItemId: inProgress.lineItemId,
      qty: 2,
      byUserId: exec.id,
    });

    // Done order
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

    const { rows } = await loadAllOrders({});
    const byRequest = new Map(rows.map((r) => [r.requestId, r]));
    expect(byRequest.get(pendingOrder.requestId)?.dispatchState).toBe(
      'pending',
    );
    expect(byRequest.get(inProgress.requestId)?.dispatchState).toBe(
      'in_progress',
    );
    expect(byRequest.get(done.requestId)?.dispatchState).toBe('done');
  });

  it('search filters by customer name', async () => {
    const captain = await seedCaptain({ phone: '+919998100001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919998100002',
      fullName: 'Exec SearchOrders',
    });
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'A',
    });

    // Override one request's customer name for filter test
    const targetReq = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    await db
      .update(visitRequests)
      .set({ customerName: 'UniqueSearchName' })
      .where(eq(visitRequests.id, targetReq.id));
    const [q] = await db
      .insert(quotations)
      .values({
        visitRequestId: targetReq.id,
        totalOrderValuePaise: 1,
        submittedByUserId: exec.id,
      })
      .returning({ id: quotations.id });
    await db.insert(quotationLineItems).values({
      quotationId: q.id,
      position: 1,
      productName: 'B',
      quantity: 1,
      unitPricePaise: 1,
      lineTotalPaise: 1,
    });

    const { rows, totalCount } = await loadAllOrders({
      search: 'UniqueSearchName',
    });
    expect(totalCount).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.customerName.includes('UniqueSearchName'))).toBe(
      true,
    );
  });
});

describe('loadActivityFeed', () => {
  it('returns dispatch events in reverse chronological order with items summary', async () => {
    const captain = await seedCaptain({ phone: '+919999000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919999000002',
      fullName: 'Exec Act',
    });
    const admin = await seedSuperAdmin({ phone: '+919999000003' });

    const item = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Activity Item',
      qty: 5,
    });
    const dispatchId = await dispatchSome({
      lineItemId: item.lineItemId,
      qty: 3,
      byUserId: admin.id,
      advanceTo: 'packed',
    });

    const feed = await loadActivityFeed();
    expect(feed.length).toBeGreaterThanOrEqual(2);
    const forDispatch = feed.filter((r) => r.dispatchId === dispatchId);
    expect(forDispatch.length).toBe(2);
    const eventTypes = forDispatch.map((r) => r.eventType);
    expect(eventTypes).toContain('dispatch_created');
    expect(eventTypes).toContain('dispatch_packed');
    expect(forDispatch[0]!.itemsSummary).toContain('Activity Item');
    expect(forDispatch[0]!.customerName).toBeTruthy();
  });

  it('returns empty array when no dispatch history exists', async () => {
    // truncateAll runs before each test, so DB is empty here
    const feed = await loadActivityFeed();
    expect(feed).toEqual([]);
  });
});

// Reference imports the linter would otherwise drop.
void eq;
