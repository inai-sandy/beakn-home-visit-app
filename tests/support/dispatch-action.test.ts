import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  auditLog,
  dispatchItems,
  dispatchStatusHistory,
  dispatches,
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
import { dispatchCreateSchema } from '@/lib/validators/dispatch';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-238: dispatch action + queue query coverage
// =============================================================================
//
// Coverage:
//   * Validator: empty items reject, qty=0 reject, qty>cap reject, too many items reject
//   * Action RBAC: support pass, exec/captain → Forbidden
//   * Action: lineItem at wrong stage (e.g., QUOTATION_GIVEN, sequence 5) → reject
//   * Action: qty > remaining → reject (also tests cumulative across multi-dispatch)
//   * Action: duplicate lineItemId in same payload → reject
//   * Action: success → writes single dispatches row + N dispatch_items
//     + single dispatch_status_history (stage='created') + audit
//   * Action: multi-order dispatch (items from 2 requests in 1 event)
//   * Queue: hides fully-dispatched items, includes partially-dispatched
//   * Queue: sort by priority desc → target_dispatch_date asc → createdAt asc
// =============================================================================

async function seedSupportUser(): Promise<{
  id: string;
  phone: string;
  password: string;
}> {
  const phone = `+91990300${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Test Support Member',
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
  return { id: u.id, phone, password };
}

async function seedOrderWithItem(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  productName?: string;
  qty?: number;
  priority?: 'low' | 'med' | 'high';
  targetDate?: string | null;
  /** Defaults to ORDER_CONFIRMED. Pass another code (e.g. QUOTATION_GIVEN)
   *  to test the stage guard. */
  statusStageCode?: string;
}): Promise<{ requestId: string; quotationId: string; lineItemId: string }> {
  const stage = await getStatusStage(opts.statusStageCode ?? 'ORDER_CONFIRMED');
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: opts.statusStageCode ?? 'ORDER_CONFIRMED',
  });
  void stage;
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
      productName: opts.productName ?? 'Test Product',
      productSku: null,
      quantity: opts.qty ?? 5,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * (opts.qty ?? 5),
      priority: opts.priority ?? 'med',
      targetDispatchDate: opts.targetDate ?? null,
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, quotationId: q.id, lineItemId: li.id };
}

const VALID_UUID = '019abcde-cafe-7000-8000-000000000001';

describe('dispatchCreateSchema', () => {
  it('accepts minimum valid payload', () => {
    const r = dispatchCreateSchema.safeParse({
      items: [{ lineItemId: VALID_UUID, qty: 3 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty items array', () => {
    const r = dispatchCreateSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
  });

  it('rejects qty=0', () => {
    const r = dispatchCreateSchema.safeParse({
      items: [{ lineItemId: VALID_UUID, qty: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects qty over cap', () => {
    const r = dispatchCreateSchema.safeParse({
      items: [{ lineItemId: VALID_UUID, qty: 1_000_000 }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects > 50 items', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      lineItemId: VALID_UUID,
      qty: i + 1,
    }));
    const r = dispatchCreateSchema.safeParse({ items });
    expect(r.success).toBe(false);
  });

  it('accepts optional notes', () => {
    const r = dispatchCreateSchema.safeParse({
      items: [{ lineItemId: VALID_UUID, qty: 1 }],
      notes: 'Picked from rack 4B',
    });
    expect(r.success).toBe(true);
  });
});

describe('addDispatchAction RBAC', () => {
  it('anonymous → "Not signed in"', async () => {
    currentCookieHeader = undefined;
    const r = await addDispatchAction({
      items: [{ lineItemId: VALID_UUID, qty: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Not signed in');
  });

  it('captain → Forbidden', async () => {
    const captain = await seedCaptain({ phone: '+919904000001' });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await addDispatchAction({
      items: [{ lineItemId: VALID_UUID, qty: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Forbidden');
  });

  it('sales_executive → Forbidden', async () => {
    const captain = await seedCaptain({ phone: '+919904000002' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919904000003',
      fullName: 'Exec Try Dispatch',
    });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await addDispatchAction({
      items: [{ lineItemId: VALID_UUID, qty: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Forbidden');
  });

  it('super_admin → allowed (escape hatch)', async () => {
    const captain = await seedCaptain({ phone: '+919904000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919904000011',
      fullName: 'Exec Owner Admin Test',
    });
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const admin = await seedSuperAdmin({ phone: '+919904000012' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
    });
    expect(r.ok).toBe(true);
  });
});

describe('addDispatchAction validations', () => {
  async function setupSupportScene() {
    const captain = await seedCaptain({ phone: `+91990500${Math.floor(Math.random() * 9000 + 1000)}` });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: `+91990500${Math.floor(Math.random() * 9000 + 1000)}`,
      fullName: 'Exec Owner',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    return { captain, city, exec, support };
  }

  it('rejects line item at wrong status stage (QUOTATION_GIVEN)', async () => {
    const { captain, city, exec } = await setupSupportScene();
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      statusStageCode: 'QUOTATION_GIVEN', // sequence 5 < 6
    });
    const r = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Order Confirmed');
  });

  it('rejects qty > remaining', async () => {
    const { captain, city, exec } = await setupSupportScene();
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      qty: 5,
    });
    const r = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 10 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain('exceeds');
  });

  it('rejects duplicate lineItemId in same payload', async () => {
    const { captain, city, exec } = await setupSupportScene();
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const r = await addDispatchAction({
      items: [
        { lineItemId: order.lineItemId, qty: 1 },
        { lineItemId: order.lineItemId, qty: 1 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('more than once');
  });

  it('rejects when remaining tracks across multiple dispatches', async () => {
    const { captain, city, exec } = await setupSupportScene();
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      qty: 5,
    });
    const first = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 3 }],
    });
    expect(first.ok).toBe(true);
    // 2 remaining now; requesting 3 should fail
    const second = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 3 }],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.toLowerCase()).toContain('exceeds');
  });
});

describe('addDispatchAction success path', () => {
  it('writes dispatch + items + status_history + audit on a single-order dispatch', async () => {
    const captain = await seedCaptain({ phone: '+919906000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919906000002',
      fullName: 'Exec OK',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      qty: 5,
    });

    const r = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 3 }],
      notes: 'Picked from main warehouse',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected success');
    const dispatchId = r.data!.dispatchId;

    // dispatches row
    const [d] = await db
      .select()
      .from(dispatches)
      .where(eq(dispatches.id, dispatchId))
      .limit(1);
    expect(d.dispatchedByUserId).toBe(support.id);
    expect(d.notes).toBe('Picked from main warehouse');

    // dispatch_items
    const items = await db
      .select()
      .from(dispatchItems)
      .where(eq(dispatchItems.dispatchId, dispatchId));
    expect(items.length).toBe(1);
    expect(items[0].quotationLineItemId).toBe(order.lineItemId);
    expect(items[0].qtyInThisDispatch).toBe(3);

    // dispatch_status_history
    const history = await db
      .select()
      .from(dispatchStatusHistory)
      .where(eq(dispatchStatusHistory.dispatchId, dispatchId));
    expect(history.length).toBe(1);
    expect(history[0].stage).toBe('created');
    expect(history[0].changedByUserId).toBe(support.id);

    // audit rows
    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, dispatchId));
    expect(audit.some((a) => a.eventType === 'dispatch_created')).toBe(true);
    const itemAudit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, order.lineItemId));
    expect(itemAudit.some((a) => a.eventType === 'dispatch_item_added')).toBe(true);
  });

  it('multi-order: items from 2 different requests in one dispatch', async () => {
    const captain = await seedCaptain({ phone: '+919907000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919907000002',
      fullName: 'Exec Multi',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    const orderA = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Product A',
    });
    const orderB = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Product B',
    });

    const r = await addDispatchAction({
      items: [
        { lineItemId: orderA.lineItemId, qty: 2 },
        { lineItemId: orderB.lineItemId, qty: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected success');

    const items = await db
      .select()
      .from(dispatchItems)
      .where(eq(dispatchItems.dispatchId, r.data!.dispatchId));
    expect(items.length).toBe(2);
    // Both items, both qtys present
    expect(items.map((i) => i.qtyInThisDispatch).sort()).toEqual([1, 2]);
  });
});

describe('loadDispatchQueue', () => {
  it('hides fully-dispatched items, shows partially-dispatched', async () => {
    const captain = await seedCaptain({ phone: '+919908000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919908000002',
      fullName: 'Exec Q',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    // Item A: qty 5, dispatch 5 → fully done → should be HIDDEN
    const orderA = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Done Item',
      qty: 5,
    });
    await addDispatchAction({
      items: [{ lineItemId: orderA.lineItemId, qty: 5 }],
    });

    // Item B: qty 5, dispatch 2 → partial → should be VISIBLE with remaining=3
    const orderB = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'Partial Item',
      qty: 5,
    });
    await addDispatchAction({
      items: [{ lineItemId: orderB.lineItemId, qty: 2 }],
    });

    const queue = await loadDispatchQueue();
    const lineItemIds = queue.map((r) => r.lineItemId);
    expect(lineItemIds).not.toContain(orderA.lineItemId);
    expect(lineItemIds).toContain(orderB.lineItemId);
    const partial = queue.find((r) => r.lineItemId === orderB.lineItemId);
    expect(partial?.quantityRemaining).toBe(3);
  });

  it('sorts by priority desc then target_dispatch_date asc', async () => {
    const captain = await seedCaptain({ phone: '+919909000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919909000002',
      fullName: 'Exec Sort',
    });

    const lowFar = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'LowFar',
      priority: 'low',
      targetDate: '2026-12-31',
    });
    const highEarly = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'HighEarly',
      priority: 'high',
      targetDate: '2026-06-10',
    });
    const highLate = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'HighLate',
      priority: 'high',
      targetDate: '2026-08-15',
    });
    const medMid = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'MedMid',
      priority: 'med',
      targetDate: '2026-07-01',
    });

    const queue = await loadDispatchQueue();
    // Restrict to just our seeded items (in case the harness leaked
    // other rows between tests).
    const ourQueue = queue.filter((r) =>
      [lowFar.lineItemId, highEarly.lineItemId, highLate.lineItemId, medMid.lineItemId].includes(
        r.lineItemId,
      ),
    );
    expect(ourQueue.map((r) => r.productName)).toEqual([
      'HighEarly', // high priority, June
      'HighLate', // high priority, August
      'MedMid', // med priority, July
      'LowFar', // low priority, December
    ]);
  });

  it('filters by customer search substring', async () => {
    const captain = await seedCaptain({ phone: '+919910000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919910000002',
      fullName: 'Exec Search',
    });
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'KitchenLight Premium',
    });
    await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      productName: 'CurtainMotor',
    });

    const kitchen = await loadDispatchQueue({ search: 'kitchen' });
    expect(kitchen.every((r) => r.productName.toLowerCase().includes('kitchen'))).toBe(true);
    expect(kitchen.length).toBeGreaterThan(0);
  });
});
