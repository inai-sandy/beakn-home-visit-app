import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  dispatchItems,
  quotationLineItems,
  quotations,
  users,
  visitRequests,
} from '@/db/schema';

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
import { loadDispatchQueue } from '@/lib/support/dispatch-queries';
import { loadAllOrders } from '@/lib/support/orders-queries';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-328: a cancelled order leaves the dispatch pipeline
// =============================================================================
//
// Reverting lib/dispatch/eligibility.ts (or the calls to it) fails every
// assertion below on the real symptom that shipped: the cancelled order's line
// item still sitting in the support queue, and addDispatchAction happily
// creating a dispatch row for it.
//
// Every case seeds TWO identical orders and cancels only one, so a test can
// never pass just because the queue came back empty.
// =============================================================================

async function seedSupportUser(): Promise<{ phone: string; password: string }> {
  const phone = `+91994100${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportCancel#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support Cancelled',
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

async function seedOrder(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  productName: string;
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
      productName: opts.productName,
      quantity: 2,
      unitPricePaise: 100000,
      lineTotalPaise: 200000,
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id };
}

/** Cancellation deliberately leaves the stage alone — that is exactly why
 *  gating on the stage sequence never caught it. */
async function cancel(requestId: string): Promise<void> {
  await db
    .update(visitRequests)
    .set({
      cancelledAt: new Date(),
      cancellationActor: 'customer',
      cancellationReason: 'No longer interested',
    })
    .where(eq(visitRequests.id, requestId));
}

async function setup() {
  const captain = await seedCaptain({ phone: '+919941000001' });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919941000002',
    fullName: 'Exec Cancelled',
  });
  const support = await seedSupportUser();
  const sess = await loginByPhone(support.phone, support.password);
  currentCookieHeader = sess.cookieHeader;

  const tag = `HVA328-${Math.floor(Math.random() * 1e6)}`;
  const live = await seedOrder({
    cityId: city.id,
    execId: exec.id,
    captainId: captain.id,
    productName: `${tag}-live`,
  });
  const dead = await seedOrder({
    cityId: city.id,
    execId: exec.id,
    captainId: captain.id,
    productName: `${tag}-cancelled`,
  });
  await cancel(dead.requestId);
  return { live, dead, tag };
}

describe('HVA-328: cancelled orders and dispatch', () => {
  it('refuses to dispatch a cancelled order, and writes no dispatch row', async () => {
    const { dead } = await setup();

    const result = await addDispatchAction({
      items: [{ lineItemId: dead.lineItemId, qty: 1 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the cancelled order to be refused');
    expect(result.error).toMatch(/cancelled/i);

    // The guard has to stop the write, not merely report an error.
    const written = await db
      .select({ id: dispatchItems.id })
      .from(dispatchItems)
      .where(eq(dispatchItems.quotationLineItemId, dead.lineItemId));
    expect(written).toHaveLength(0);
  });

  it('still dispatches an identical order that was NOT cancelled', async () => {
    const { live } = await setup();

    const result = await addDispatchAction({
      items: [{ lineItemId: live.lineItemId, qty: 1 }],
    });

    // Without this the refusal above could be passing for any other reason.
    expect(result.ok).toBe(true);
  });

  it('drops the cancelled order from the support queue and keeps the live one', async () => {
    const { tag } = await setup();

    const queue = await loadDispatchQueue({ pageSize: 200 });
    const names = queue.rows.map((r) => r.productName);

    expect(names).toContain(`${tag}-live`);
    expect(names).not.toContain(`${tag}-cancelled`);
  });

  it('keeps the cancelled order in the Orders tab, marked cancelled', async () => {
    const { dead } = await setup();

    const orders = await loadAllOrders({ pageSize: 200 });
    const row = orders.rows.find((r) => r.requestId === dead.requestId);

    // The Orders tab is the record, not a work queue — stock already shipped
    // has to stay visible so it can be chased back. It just has to say so,
    // rather than reading "Pending" the way it used to.
    expect(row).toBeDefined();
    expect(row!.dispatchState).toBe('cancelled');
  });
});
