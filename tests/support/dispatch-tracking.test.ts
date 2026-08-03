import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  auditLog,
  dispatches,
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
import { updateDispatchTrackingAction } from '@/app/(support)/support/_actions/updateDispatchTracking';
import { loadOrderDetail } from '@/lib/support/order-detail';
import {
  dispatchCreateSchema,
  updateDispatchTrackingSchema,
} from '@/lib/validators/dispatch';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-303: courier + tracking number per shipment
// =============================================================================
//
// Courier details are plain text and tracked manually on the courier's own
// site — there is deliberately no URL derivation to test. What matters is
// that the details persist per shipment, can be filled in after the fact
// (the courier is usually booked after the package is packed), and can be
// corrected without touching anything else on the row.
// =============================================================================

const VALID_UUID = '019abcde-cafe-7000-8000-000000000009';

// seedCaptain/seedExecutive default to a fixed phone, which is a unique
// column — every seeded user in this file needs its own number.
let phoneSeq = 0;
function nextPhone(prefix: string): string {
  phoneSeq += 1;
  return `+91${prefix}${String(phoneSeq).padStart(5, '0')}`;
}

async function seedSupportUser(): Promise<{
  id: string;
  phone: string;
  password: string;
}> {
  const phone = `+91990310${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Tracking Test Support',
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

async function seedOrder(): Promise<{
  requestId: string;
  lineItemId: string;
  execId: string;
}> {
  const city = await getOrCreateCity('Tracking Test City');
  const captain = await seedCaptain({ phone: nextPhone('99051') });
  const exec = await seedExecutive(captain.id, { phone: nextPhone('99052') });
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
      productName: 'Kitchen Light',
      productSku: null,
      quantity: 5,
      unitPricePaise: 100000,
      lineTotalPaise: 500000,
      priority: 'med',
      targetDispatchDate: null,
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id, execId: exec.id };
}

describe('courier validators', () => {
  it('accepts a dispatch with no courier details at all', () => {
    const r = dispatchCreateSchema.safeParse({
      items: [{ lineItemId: VALID_UUID, qty: 1 }],
    });
    expect(r.success).toBe(true);
  });

  it('treats a blank courier name as absent rather than an empty string', () => {
    const r = dispatchCreateSchema.safeParse({
      items: [{ lineItemId: VALID_UUID, qty: 1 }],
      courierName: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.courierName).toBeUndefined();
  });

  it('trims surrounding whitespace off the tracking number', () => {
    const r = updateDispatchTrackingSchema.safeParse({
      dispatchId: VALID_UUID,
      trackingNumber: '  1234567890  ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.trackingNumber).toBe('1234567890');
  });

  it('rejects an absurdly long courier name', () => {
    const r = updateDispatchTrackingSchema.safeParse({
      dispatchId: VALID_UUID,
      courierName: 'x'.repeat(121),
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid dispatch id', () => {
    const r = updateDispatchTrackingSchema.safeParse({
      dispatchId: 'not-a-uuid',
      courierName: 'Delhivery',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateDispatchTrackingAction — RBAC', () => {
  it('rejects an anonymous caller', async () => {
    currentCookieHeader = undefined;
    const r = await updateDispatchTrackingAction({
      dispatchId: VALID_UUID,
      courierName: 'Delhivery',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Not signed in');
  });

  it('forbids the sales executive — support owns dispatch', async () => {
    const captain = await seedCaptain({ phone: nextPhone('99053') });
    const exec = await seedExecutive(captain.id, { phone: nextPhone('99054') });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await updateDispatchTrackingAction({
      dispatchId: VALID_UUID,
      courierName: 'Delhivery',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Forbidden');
  });
});

describe('courier details on a shipment', () => {
  it('persists courier details recorded at dispatch time', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      courierName: 'Delhivery',
      trackingNumber: '1234567890',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [row] = await db
      .select({
        courierName: dispatches.courierName,
        trackingNumber: dispatches.trackingNumber,
      })
      .from(dispatches)
      .where(eq(dispatches.id, created.data!.dispatchId));

    expect(row.courierName).toBe('Delhivery');
    expect(row.trackingNumber).toBe('1234567890');
  });

  it('leaves courier details null when the courier is not booked yet', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [row] = await db
      .select({
        courierName: dispatches.courierName,
        trackingNumber: dispatches.trackingNumber,
      })
      .from(dispatches)
      .where(eq(dispatches.id, created.data!.dispatchId));

    expect(row.courierName).toBeNull();
    expect(row.trackingNumber).toBeNull();
  });

  it('fills in the tracking number after the fact — the handoff case', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    const dispatchId = created.data!.dispatchId;

    const updated = await updateDispatchTrackingAction({
      dispatchId,
      courierName: 'Blue Dart',
      trackingNumber: '9988776655',
    });
    expect(updated.ok).toBe(true);

    const [row] = await db
      .select({
        courierName: dispatches.courierName,
        trackingNumber: dispatches.trackingNumber,
        notes: dispatches.notes,
      })
      .from(dispatches)
      .where(eq(dispatches.id, dispatchId));

    expect(row.courierName).toBe('Blue Dart');
    expect(row.trackingNumber).toBe('9988776655');
    // Narrow update — nothing else on the row was disturbed.
    expect(row.notes).toBeNull();
  });

  it('corrects a mistyped tracking number and audits the change', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
      courierName: 'Delhivery',
      trackingNumber: '1111111111',
    });
    if (!created.ok) throw new Error('dispatch not created');
    const dispatchId = created.data!.dispatchId;

    await updateDispatchTrackingAction({
      dispatchId,
      courierName: 'Delhivery',
      trackingNumber: '2222222222',
    });

    const [row] = await db
      .select({ trackingNumber: dispatches.trackingNumber })
      .from(dispatches)
      .where(eq(dispatches.id, dispatchId));
    expect(row.trackingNumber).toBe('2222222222');

    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, dispatchId));
    // dispatch_created + dispatch_tracking_updated both land on the row.
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('clears a wrongly attached tracking number', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    const created = await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
      courierName: 'Delhivery',
      trackingNumber: '1234567890',
    });
    if (!created.ok) throw new Error('dispatch not created');
    const dispatchId = created.data!.dispatchId;

    const cleared = await updateDispatchTrackingAction({ dispatchId });
    expect(cleared.ok).toBe(true);

    const [row] = await db
      .select({
        courierName: dispatches.courierName,
        trackingNumber: dispatches.trackingNumber,
      })
      .from(dispatches)
      .where(eq(dispatches.id, dispatchId));
    expect(row.courierName).toBeNull();
    expect(row.trackingNumber).toBeNull();
  });

  it('rejects an unknown dispatch id', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await updateDispatchTrackingAction({
      dispatchId: VALID_UUID,
      courierName: 'Delhivery',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Dispatch not found');
  });

  it('surfaces courier details to exec + captain via loadOrderDetail', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      courierName: 'DTDC',
      trackingNumber: '5555544444',
    });

    // This is the loader /requests/[id] uses — if courier details don't
    // come through here, the exec can't see them at all.
    const detail = await loadOrderDetail(order.requestId);
    expect(detail).not.toBeNull();
    expect(detail!.dispatches).toHaveLength(1);
    expect(detail!.dispatches[0].courierName).toBe('DTDC');
    expect(detail!.dispatches[0].trackingNumber).toBe('5555544444');
  });

  it('keeps a separate courier per installment of the same order', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const order = await seedOrder();

    await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      courierName: 'Delhivery',
      trackingNumber: '1111111111',
    });
    await addDispatchAction({
      items: [{ lineItemId: order.lineItemId, qty: 3 }],
      courierName: 'Blue Dart',
      trackingNumber: '2222222222',
    });

    const detail = await loadOrderDetail(order.requestId);
    expect(detail!.dispatches).toHaveLength(2);
    const couriers = detail!.dispatches.map((d) => d.courierName).sort();
    expect(couriers).toEqual(['Blue Dart', 'Delhivery']);
  });
});
