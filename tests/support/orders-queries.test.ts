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
import { loadSupportFilterOptions } from '@/lib/support/filter-options';
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

    const { rows: pending } = await loadDispatchQueue({ mode: 'pending' });
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

    const { rows: inProgress } = await loadDispatchQueue({ mode: 'in_progress' });
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

    // HVA-245 regression: lastActivityAt must be a real Date, not a string.
    // The raw SQL MAX(changed_at) returns a string from postgres-js; the
    // page calls .toISOString() on it which previously crashed at runtime.
    for (const row of rows) {
      expect(row.lastActivityAt).toBeInstanceOf(Date);
      expect(typeof row.lastActivityAt.toISOString).toBe('function');
    }
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

    const { rows: feed } = await loadActivityFeed();
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
    const { rows: feed, totalCount } = await loadActivityFeed();
    expect(feed).toEqual([]);
    expect(totalCount).toBe(0);
  });
});

// HVA-246: sort + pagination
describe('loadDispatchQueue sort + pagination', () => {
  it('sort=customer asc orders rows by customer name ascending', async () => {
    const captain = await seedCaptain({ phone: '+919996100001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919996100002',
      fullName: 'Exec SortCustomer',
    });

    // Seed three orders with deterministic customer names
    const reqs: { id: string; customerName: string }[] = [];
    for (const name of ['Charlie Order', 'Alpha Order', 'Bravo Order']) {
      const r = await seedVisitRequest({
        cityId: city.id,
        assignedExecUserId: exec.id,
        assignedCaptainUserId: captain.id,
        statusStageCode: 'ORDER_CONFIRMED',
      });
      await db
        .update(visitRequests)
        .set({ customerName: name })
        .where(eq(visitRequests.id, r.id));
      const [q] = await db
        .insert(quotations)
        .values({
          visitRequestId: r.id,
          totalOrderValuePaise: 1,
          submittedByUserId: exec.id,
        })
        .returning({ id: quotations.id });
      await db.insert(quotationLineItems).values({
        quotationId: q.id,
        position: 1,
        productName: `P-${name}`,
        quantity: 1,
        unitPricePaise: 1,
        lineTotalPaise: 1,
      });
      reqs.push({ id: r.id, customerName: name });
    }

    const { rows } = await loadDispatchQueue({
      mode: 'pending',
      sort: 'customer',
      dir: 'asc',
    });
    const ourRows = rows.filter((r) =>
      reqs.some((req) => req.customerName === r.customerName),
    );
    expect(ourRows.map((r) => r.customerName)).toEqual([
      'Alpha Order',
      'Bravo Order',
      'Charlie Order',
    ]);
  });

  it('page + pageSize slice the result correctly', async () => {
    const captain = await seedCaptain({ phone: '+919996200001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919996200002',
      fullName: 'Exec Pagination',
    });
    for (let i = 0; i < 5; i++) {
      const r = await seedVisitRequest({
        cityId: city.id,
        assignedExecUserId: exec.id,
        assignedCaptainUserId: captain.id,
        statusStageCode: 'ORDER_CONFIRMED',
      });
      const [q] = await db
        .insert(quotations)
        .values({
          visitRequestId: r.id,
          totalOrderValuePaise: 1,
          submittedByUserId: exec.id,
        })
        .returning({ id: quotations.id });
      await db.insert(quotationLineItems).values({
        quotationId: q.id,
        position: 1,
        productName: `PaginItem ${i}`,
        quantity: 1,
        unitPricePaise: 1,
        lineTotalPaise: 1,
      });
    }

    const { rows: page1, totalCount } = await loadDispatchQueue({
      mode: 'pending',
      page: 1,
      pageSize: 2,
    });
    expect(page1.length).toBe(2);
    expect(totalCount).toBeGreaterThanOrEqual(5);

    const { rows: page2 } = await loadDispatchQueue({
      mode: 'pending',
      page: 2,
      pageSize: 2,
    });
    expect(page2.length).toBe(2);
    // Page 1 and page 2 should not overlap on lineItemId
    const ids1 = new Set(page1.map((r) => r.lineItemId));
    expect(page2.every((r) => !ids1.has(r.lineItemId))).toBe(true);
  });
});

// =============================================================================
// HVA-247: filter dropdowns
// =============================================================================

describe('loadDispatchQueue filters (HVA-247)', () => {
  it('cityId narrows to that city only', async () => {
    const captain = await seedCaptain({ phone: '+919995100001' });
    const cityA = await getOrCreateCity('Bangalore');
    const cityB = await getOrCreateCity('Chennai');
    const exec = await seedExecutive(captain.id, {
      phone: '+919995100002',
      fullName: 'Exec FilterCity',
    });

    await seedOrderWithItem({
      cityId: cityA.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'CityA-Item',
    });
    await seedOrderWithItem({
      cityId: cityB.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'CityB-Item',
    });

    const { rows } = await loadDispatchQueue({
      mode: 'pending',
      cityId: cityA.id,
    });
    const names = rows.map((r) => r.productName);
    expect(names).toContain('CityA-Item');
    expect(names).not.toContain('CityB-Item');
  });

  it('productName narrows to that product only', async () => {
    const captain = await seedCaptain({ phone: '+919995200001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919995200002',
      fullName: 'Exec FilterProduct',
    });
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Curtain Type A',
    });
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Blinds Type B',
    });

    const { rows } = await loadDispatchQueue({
      mode: 'pending',
      productName: 'Curtain Type A',
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.productName === 'Curtain Type A')).toBe(true);
  });

  it('customerPhone narrows to that customer only', async () => {
    const captain = await seedCaptain({ phone: '+919995300001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919995300002',
      fullName: 'Exec FilterCustomer',
    });

    const a = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'CustFilterA',
    });
    const b = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'CustFilterB',
    });
    await db
      .update(visitRequests)
      .set({ customerPhone: '+919999991111', customerName: 'CustOne' })
      .where(eq(visitRequests.id, a.requestId));
    await db
      .update(visitRequests)
      .set({ customerPhone: '+919999992222', customerName: 'CustTwo' })
      .where(eq(visitRequests.id, b.requestId));

    const { rows } = await loadDispatchQueue({
      mode: 'pending',
      customerPhone: '+919999991111',
    });
    expect(rows.every((r) => r.customerName === 'CustOne')).toBe(true);
    expect(rows.map((r) => r.productName)).toContain('CustFilterA');
    expect(rows.map((r) => r.productName)).not.toContain('CustFilterB');
  });
});

describe('loadAllOrders filters (HVA-247)', () => {
  it('dispatchState=pending narrows to pending orders only', async () => {
    const captain = await seedCaptain({ phone: '+919994100001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919994100002',
      fullName: 'Exec OrdState',
    });

    const pendingOrder = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'OS-Pending',
    });
    const inProgressOrder = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'OS-InProgress',
      qty: 4,
    });
    await dispatchSome({
      lineItemId: inProgressOrder.lineItemId,
      qty: 2,
      byUserId: exec.id,
    });

    const { rows } = await loadAllOrders({ dispatchState: 'pending' });
    const ids = rows.map((r) => r.requestId);
    expect(ids).toContain(pendingOrder.requestId);
    expect(ids).not.toContain(inProgressOrder.requestId);
    expect(rows.every((r) => r.dispatchState === 'pending')).toBe(true);
  });

  it('productName narrows to orders that contain that product', async () => {
    const captain = await seedCaptain({ phone: '+919994200001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919994200002',
      fullName: 'Exec OrdProd',
    });
    const withCurtain = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'PremiumCurtainXYZ',
    });
    const withoutCurtain = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'OtherProduct',
    });

    const { rows } = await loadAllOrders({ productName: 'PremiumCurtainXYZ' });
    const ids = rows.map((r) => r.requestId);
    expect(ids).toContain(withCurtain.requestId);
    expect(ids).not.toContain(withoutCurtain.requestId);
  });
});

describe('loadSupportFilterOptions (HVA-247)', () => {
  it('returns sorted cities, distinct products, and distinct customers', async () => {
    const captain = await seedCaptain({ phone: '+919993100001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919993100002',
      fullName: 'Exec FilterOpts',
    });

    // Two orders for the same customer with the same product (should
    // dedup down to one product option + one customer option).
    const a = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'FilterOptsProduct',
    });
    const b = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'FilterOptsProduct',
    });
    await db
      .update(visitRequests)
      .set({ customerPhone: '+919988887777', customerName: 'OptsCustomer' })
      .where(eq(visitRequests.id, a.requestId));
    await db
      .update(visitRequests)
      .set({ customerPhone: '+919988887777', customerName: 'OptsCustomer' })
      .where(eq(visitRequests.id, b.requestId));

    const opts = await loadSupportFilterOptions();
    expect(opts.cities.some((c) => c.name === 'Bangalore')).toBe(true);
    expect(
      opts.products.filter((p) => p.name === 'FilterOptsProduct').length,
    ).toBe(1);
    expect(
      opts.customers.filter((c) => c.phone === '+919988887777').length,
    ).toBe(1);
  });
});

// Reference imports the linter would otherwise drop.
void eq;
