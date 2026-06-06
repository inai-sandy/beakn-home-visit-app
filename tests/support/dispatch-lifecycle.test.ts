import { hashPassword } from 'better-auth/crypto';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  auditLog,
  dispatchStatusHistory,
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
import { loadOrderDetail } from '@/lib/support/order-detail';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-239 (HVA-231 Phase 2 PR-B): dispatch lifecycle + order-detail loader
// =============================================================================

async function seedSupportUser(): Promise<{
  id: string;
  phone: string;
  password: string;
}> {
  const phone = `+91995000${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support Lifecycle',
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
}): Promise<{ requestId: string; lineItemId: string; quotationId: string }> {
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
      submittedByUserId: opts.execId,
    })
    .returning({ id: quotations.id });
  const [li] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: q.id,
      position: 1,
      productName: opts.productName ?? 'Lifecycle Item',
      quantity: opts.qty ?? 3,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * (opts.qty ?? 3),
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id, quotationId: q.id };
}

describe('advanceDispatchStageAction', () => {
  it('happy path: created → packed → handed_off', async () => {
    const captain = await seedCaptain({ phone: '+919960000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919960000002',
      fullName: 'Exec Life',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const dispatch = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!dispatch.ok) throw new Error('seed dispatch failed');
    const dispatchId = dispatch.data!.dispatchId;

    // created → packed
    const r1 = await advanceDispatchStageAction({ dispatchId, toStage: 'packed' });
    expect(r1.ok).toBe(true);

    // packed → handed_off
    const r2 = await advanceDispatchStageAction({ dispatchId, toStage: 'handed_off' });
    expect(r2.ok).toBe(true);

    const history = await db
      .select({ stage: dispatchStatusHistory.stage })
      .from(dispatchStatusHistory)
      .where(eq(dispatchStatusHistory.dispatchId, dispatchId))
      .orderBy(asc(dispatchStatusHistory.changedAt));
    expect(history.map((h) => h.stage)).toEqual([
      'created',
      'packed',
      'handed_off',
    ]);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, dispatchId));
    expect(audit.filter((a) => a.eventType === 'dispatch_advanced').length).toBe(2);
  });

  it('rejects skipping a stage (created → handed_off)', async () => {
    const captain = await seedCaptain({ phone: '+919960000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919960000011',
      fullName: 'Exec SkipStage',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const dispatch = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!dispatch.ok) throw new Error('seed dispatch failed');

    const r = await advanceDispatchStageAction({
      dispatchId: dispatch.data!.dispatchId,
      toStage: 'handed_off',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain('next allowed step is packed');
  });

  it('rejects already-handed-off (no further stage)', async () => {
    const captain = await seedCaptain({ phone: '+919960000020' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919960000021',
      fullName: 'Exec Done',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const dispatch = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!dispatch.ok) throw new Error('seed dispatch failed');
    const dispatchId = dispatch.data!.dispatchId;
    await advanceDispatchStageAction({ dispatchId, toStage: 'packed' });
    await advanceDispatchStageAction({ dispatchId, toStage: 'handed_off' });
    const r = await advanceDispatchStageAction({ dispatchId, toStage: 'packed' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain('final stage');
  });

  it('RBAC: captain → Forbidden', async () => {
    const captain = await seedCaptain({ phone: '+919960000030' });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await advanceDispatchStageAction({
      dispatchId: '019abcde-cafe-7000-8000-000000000001',
      toStage: 'packed',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Forbidden');
  });

  it('rejects unknown dispatchId', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await advanceDispatchStageAction({
      dispatchId: '019abcde-cafe-7000-8000-000000000001',
      toStage: 'packed',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain('not found');
  });
});

describe('loadOrderDetail', () => {
  it('returns null for unknown request id', async () => {
    const detail = await loadOrderDetail('019abcde-cafe-7000-8000-000000000099');
    expect(detail).toBe(null);
  });

  it('includes both fully-dispatched and partially-dispatched items', async () => {
    const captain = await seedCaptain({ phone: '+919961000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919961000002',
      fullName: 'Exec Detail',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    // Use a single request with two items (one fully dispatched, one partial)
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
        submittedByUserId: exec.id,
      })
      .returning({ id: quotations.id });
    const [itemDone] = await db
      .insert(quotationLineItems)
      .values({
        quotationId: q.id,
        position: 1,
        productName: 'Done Item',
        quantity: 3,
        unitPricePaise: 100000,
        lineTotalPaise: 300000,
      })
      .returning({ id: quotationLineItems.id });
    const [itemPartial] = await db
      .insert(quotationLineItems)
      .values({
        quotationId: q.id,
        position: 2,
        productName: 'Partial Item',
        quantity: 5,
        unitPricePaise: 100000,
        lineTotalPaise: 500000,
      })
      .returning({ id: quotationLineItems.id });

    // Dispatch 1: all of done item + 2 of partial
    const dispatchResult = await addDispatchAction({
      items: [
        { lineItemId: itemDone.id, qty: 3 },
        { lineItemId: itemPartial.id, qty: 2 },
      ],
    });
    if (!dispatchResult.ok) {
      throw new Error(`addDispatchAction failed: ${dispatchResult.error}`);
    }

    const detail = await loadOrderDetail(req.id);
    expect(detail).not.toBeNull();
    if (!detail) throw new Error('expected detail');
    expect(detail.items.length).toBe(2);
    const done = detail.items.find((i) => i.productName === 'Done Item');
    const partial = detail.items.find((i) => i.productName === 'Partial Item');
    expect(done?.quantityRemaining).toBe(0);
    expect(done?.quantityDispatched).toBe(3);
    expect(partial?.quantityRemaining).toBe(3);
    expect(partial?.quantityDispatched).toBe(2);
    expect(detail.dispatches.length).toBe(1);
    expect(detail.dispatches[0].currentStage).toBe('created');
    expect(detail.dispatches[0].items.length).toBe(2);
  });

  it('reflects the latest stage from dispatch_status_history', async () => {
    const captain = await seedCaptain({ phone: '+919961000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919961000011',
      fullName: 'Exec Stage',
    });
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrderWithItem({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const dispatch = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!dispatch.ok) throw new Error('seed dispatch failed');
    await advanceDispatchStageAction({
      dispatchId: dispatch.data!.dispatchId,
      toStage: 'packed',
    });

    const detail = await loadOrderDetail(order.requestId);
    if (!detail) throw new Error('expected detail');
    expect(detail.dispatches.length).toBe(1);
    expect(detail.dispatches[0].currentStage).toBe('packed');
  });
});
