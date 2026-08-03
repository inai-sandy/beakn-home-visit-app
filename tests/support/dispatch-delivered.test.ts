import { hashPassword } from 'better-auth/crypto';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  quotationLineItems,
  quotations,
  users,
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
import { advanceDispatchStageAction } from '@/app/(support)/support/_actions/advanceDispatchStage';
import { loadDispatchQueue } from '@/lib/support/dispatch-queries';
import { loadAllOrders } from '@/lib/support/orders-queries';
import { loadOrderDetail } from '@/lib/support/order-detail';
import {
  CLOSED_DISPATCH_STAGES,
  NEXT_STAGE,
  advanceDispatchStageSchema,
} from '@/lib/validators/dispatch-stage';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-304: 'delivered' stage
// =============================================================================
//
// The regression this file mainly exists to prevent: "is this shipment still
// open" used to be `stage <> 'handed_off'` in two separate raw-SQL
// predicates. Adding a stage after handed_off without widening BOTH makes
// every delivered shipment look open, which silently drags fully completed
// orders back into `in_progress`.
// =============================================================================

let phoneSeq = 0;
function nextPhone(prefix: string): string {
  phoneSeq += 1;
  return `+91${prefix}${String(phoneSeq).padStart(5, '0')}`;
}

async function seedSupportUser(): Promise<{ phone: string; password: string }> {
  const phone = nextPhone('99061');
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Delivered Test Support',
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

async function seedOrder(qty = 2): Promise<{
  requestId: string;
  lineItemId: string;
}> {
  const city = await getOrCreateCity('Delivered Test City');
  const captain = await seedCaptain({ phone: nextPhone('99062') });
  const exec = await seedExecutive(captain.id, { phone: nextPhone('99063') });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
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
      productName: 'Curtain Motor',
      productSku: null,
      quantity: qty,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * qty,
      priority: 'med',
      targetDispatchDate: null,
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id };
}

/** Walk a dispatch all the way to delivered. */
async function deliver(dispatchId: string) {
  for (const toStage of ['packed', 'handed_off', 'delivered'] as const) {
    const r = await advanceDispatchStageAction({ dispatchId, toStage });
    expect(r.ok).toBe(true);
  }
}

describe('dispatch stage model', () => {
  it('makes delivered the step after handed_off', () => {
    expect(NEXT_STAGE.handed_off).toBe('delivered');
  });

  it('makes delivered terminal', () => {
    expect(NEXT_STAGE.delivered).toBeUndefined();
  });

  it('counts both handed_off and delivered as closed', () => {
    // The single source of truth behind both raw-SQL "open dispatch"
    // predicates. If this list shrinks, those queries silently break.
    expect([...CLOSED_DISPATCH_STAGES].sort()).toEqual([
      'delivered',
      'handed_off',
    ]);
  });

  it('accepts delivered as an advance target', () => {
    const r = advanceDispatchStageSchema.safeParse({
      dispatchId: '019abcde-cafe-7000-8000-00000000000a',
      toStage: 'delivered',
    });
    expect(r.success).toBe(true);
  });
});

describe('advancing to delivered', () => {
  it('walks created → packed → handed_off → delivered', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    await deliver(created.data!.dispatchId);

    const detail = await loadOrderDetail(order.requestId);
    expect(detail!.dispatches[0].currentStage).toBe('delivered');
  });

  it('refuses to skip handed_off', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    const dispatchId = created.data!.dispatchId;

    await advanceDispatchStageAction({ dispatchId, toStage: 'packed' });
    const skipped = await advanceDispatchStageAction({
      dispatchId,
      toStage: 'delivered',
    });
    expect(skipped.ok).toBe(false);
  });

  it('refuses to advance past delivered', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    const dispatchId = created.data!.dispatchId;
    await deliver(dispatchId);

    const again = await advanceDispatchStageAction({
      dispatchId,
      toStage: 'delivered',
    });
    expect(again.ok).toBe(false);
  });
});

describe('delivered counts as closed, not open', () => {
  it('keeps a fully delivered order at dispatchState=done', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const order = await seedOrder(2);

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    await deliver(created.data!.dispatchId);

    const { rows } = await loadAllOrders({ page: 1, pageSize: 200 });
    const row = rows.find((r) => r.requestId === order.requestId);
    expect(row).toBeDefined();
    // The regression guard: with the old `<> 'handed_off'` predicate this
    // came back 'in_progress' because delivered read as an open dispatch.
    expect(row!.dispatchState).toBe('done');
    expect(row!.qtyRemaining).toBe(0);
  });

  it('still reports in_progress while a shipment sits at packed', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const order = await seedOrder(2);

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    await advanceDispatchStageAction({
      dispatchId: created.data!.dispatchId,
      toStage: 'packed',
    });

    const { rows } = await loadAllOrders({ page: 1, pageSize: 200 });
    const row = rows.find((r) => r.requestId === order.requestId);
    expect(row!.dispatchState).toBe('in_progress');
  });

  it('drops a delivered line item out of the support open-dispatch queue', async () => {
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;
    const order = await seedOrder(2);

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    await deliver(created.data!.dispatchId);

    const queue = await loadDispatchQueue({ mode: 'in_progress', limit: 200 });
    const stillListed = queue.rows.some(
      (r) => r.lineItemId === order.lineItemId,
    );
    expect(stillListed).toBe(false);
  });
});
