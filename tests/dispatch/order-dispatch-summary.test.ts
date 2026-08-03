import { hashPassword } from 'better-auth/crypto';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { accounts, quotationLineItems, quotations, users } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { addDispatchAction } from '@/app/(support)/support/_actions/addDispatch';
import { advanceDispatchStageAction } from '@/app/(support)/support/_actions/advanceDispatchStage';
import { fetchCaptainRequests } from '@/lib/captain/requests-queries';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-305: the dispatch aggregate, exercised through real SQL
// =============================================================================
//
// deriveOrderDispatchSummary is unit-tested separately. What this file
// covers is the part that can actually be wrong: four correlated
// subqueries walking visit_requests → quotations → quotation_line_items →
// dispatch_items → dispatches, and the latest-stage-per-dispatch lateral
// that decides whether a shipment counts as delivered.
//
// Goes through fetchCaptainRequests because the captain list is the harder
// of the two call sites (team scope + bucket counts) — if the aggregate is
// correct there it is correct on the exec list, which shares the helper.
// =============================================================================

let phoneSeq = 0;
function nextPhone(prefix: string): string {
  phoneSeq += 1;
  return `+91${prefix}${String(phoneSeq).padStart(5, '0')}`;
}

async function seedSupportUser(): Promise<{ phone: string; password: string }> {
  const phone = nextPhone('99071');
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Summary Test Support',
      phone,
      phoneVerified: true,
      isActive: true,
      mustChangePassword: false,
    })
    .returning({ id: users.id });
  await db.insert(accounts).values({
    accountId: u.id,
    providerId: 'credential',
    userId: u.id,
    password: hash,
  });
  return { phone, password };
}

async function seedScenario(opts: {
  qty: number;
  statusStageCode?: string;
}): Promise<{
  requestId: string;
  lineItemId: string;
  captainId: string;
  cityId: string;
}> {
  const city = await getOrCreateCity(`Summary City ${phoneSeq}`);
  const captain = await seedCaptain({ phone: nextPhone('99072') });
  const exec = await seedExecutive(captain.id, { phone: nextPhone('99073') });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: opts.statusStageCode ?? 'ORDER_CONFIRMED',
  });
  const [q] = await db
    .insert(quotations)
    .values({
      visitRequestId: req.id,
      totalOrderValuePaise: 100000,
      source: 'portal',
      submittedByUserId: exec.id,
    })
    .returning({ id: quotations.id });
  const [li] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: q.id,
      position: 1,
      productName: 'Smart Lock',
      productSku: null,
      quantity: opts.qty,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * opts.qty,
      priority: 'med',
      targetDispatchDate: null,
    })
    .returning({ id: quotationLineItems.id });
  return {
    requestId: req.id,
    lineItemId: li.id,
    captainId: captain.id,
    cityId: city.id,
  };
}

async function captainRowFor(scenario: {
  requestId: string;
  captainId: string;
  cityId: string;
}) {
  const { rows } = await fetchCaptainRequests({
    captainUserId: scenario.captainId,
    cityIds: [scenario.cityId],
    isSuperAdmin: false,
    bucket: 'all',
    page: 1,
  });
  return rows.find((r) => r.id === scenario.requestId);
}

describe('order dispatch summary on the captain list', () => {
  it('reports the shipped/ordered split for a part-shipped order', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const s = await seedScenario({ qty: 8 });

    await addDispatchAction({
      items: [{ lineItemId: s.lineItemId, qty: 3 }],
    });

    const row = await captainRowFor(s);
    expect(row).toBeDefined();
    expect(row!.dispatch).not.toBeNull();
    expect(row!.dispatch!.unitsTotal).toBe(8);
    expect(row!.dispatch!.unitsShipped).toBe(3);
    expect(row!.dispatch!.state).toBe('partial');
    expect(row!.dispatch!.shipmentCount).toBe(1);
  });

  it('sums units across several installments', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const s = await seedScenario({ qty: 8 });

    await addDispatchAction({ items: [{ lineItemId: s.lineItemId, qty: 3 }] });
    await addDispatchAction({ items: [{ lineItemId: s.lineItemId, qty: 2 }] });

    const row = await captainRowFor(s);
    expect(row!.dispatch!.unitsShipped).toBe(5);
    expect(row!.dispatch!.shipmentCount).toBe(2);
    expect(row!.dispatch!.state).toBe('partial');
  });

  it('reports pending before anything ships', async () => {
    const s = await seedScenario({ qty: 4 });
    const row = await captainRowFor(s);
    expect(row!.dispatch!.state).toBe('pending');
    expect(row!.dispatch!.unitsShipped).toBe(0);
    expect(row!.dispatch!.shipmentCount).toBe(0);
  });

  it('reports complete-but-not-delivered once every unit is out', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const s = await seedScenario({ qty: 4 });

    await addDispatchAction({ items: [{ lineItemId: s.lineItemId, qty: 4 }] });

    const row = await captainRowFor(s);
    expect(row!.dispatch!.state).toBe('complete');
    expect(row!.dispatch!.fullyDelivered).toBe(false);
  });

  it('flips to fully delivered only once the shipment is marked delivered', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const s = await seedScenario({ qty: 4 });

    const created = await addDispatchAction({
      items: [{ lineItemId: s.lineItemId, qty: 4 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    const dispatchId = created.data!.dispatchId;

    // Latest-stage-per-dispatch: still not delivered at handed_off.
    await advanceDispatchStageAction({ dispatchId, toStage: 'packed' });
    await advanceDispatchStageAction({ dispatchId, toStage: 'handed_off' });
    let row = await captainRowFor(s);
    expect(row!.dispatch!.deliveredShipmentCount).toBe(0);
    expect(row!.dispatch!.fullyDelivered).toBe(false);

    await advanceDispatchStageAction({ dispatchId, toStage: 'delivered' });
    row = await captainRowFor(s);
    expect(row!.dispatch!.deliveredShipmentCount).toBe(1);
    expect(row!.dispatch!.fullyDelivered).toBe(true);
  });

  it('does not claim delivered while one of two shipments is still moving', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const s = await seedScenario({ qty: 5 });

    const first = await addDispatchAction({
      items: [{ lineItemId: s.lineItemId, qty: 2 }],
    });
    const second = await addDispatchAction({
      items: [{ lineItemId: s.lineItemId, qty: 3 }],
    });
    if (!first.ok || !second.ok) throw new Error('dispatch not created');

    for (const toStage of ['packed', 'handed_off', 'delivered'] as const) {
      await advanceDispatchStageAction({
        dispatchId: first.data!.dispatchId,
        toStage,
      });
    }

    const row = await captainRowFor(s);
    expect(row!.dispatch!.state).toBe('complete'); // all units are out
    expect(row!.dispatch!.shipmentCount).toBe(2);
    expect(row!.dispatch!.deliveredShipmentCount).toBe(1);
    expect(row!.dispatch!.fullyDelivered).toBe(false);
  });

  it('leaves dispatch null before ORDER_CONFIRMED', async () => {
    const s = await seedScenario({ qty: 4, statusStageCode: 'QUOTATION_GIVEN' });
    const row = await captainRowFor(s);
    expect(row).toBeDefined();
    // Nothing is meant to ship yet — the row should read quiet, not
    // "Not shipped".
    expect(row!.dispatch).toBeNull();
  });

  it('keeps bucket counts unaffected by the aggregate', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const s = await seedScenario({ qty: 4 });
    await addDispatchAction({ items: [{ lineItemId: s.lineItemId, qty: 4 }] });

    const { bucketCounts, total } = await fetchCaptainRequests({
      captainUserId: s.captainId,
      cityIds: [s.cityId],
      isSuperAdmin: false,
      bucket: 'all',
      page: 1,
    });
    // The D6 count pass runs separately from the rows query; adding the
    // dispatch subqueries must not have perturbed it.
    expect(total).toBe(1);
    expect(bucketCounts.all).toBe(1);
  });
});
