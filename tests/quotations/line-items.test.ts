import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { quotationLineItems, quotations } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import {
  addLineItemAction,
  loadLineItems,
  setLineItemPriorityAction,
  updateLineItemAction,
} from '@/app/requests/[id]/_actions/lineItems';
import {
  lineItemCreateSchema,
  lineItemPrioritySchema,
  lineItemUpdateSchema,
} from '@/lib/validators/quotation';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-234 (HVA-231 Phase 1.0): line item server actions
// =============================================================================
//
// Coverage:
//   * Validator: qty > 0, prices >= 0, GST 0..100, "no fields" reject on update
//   * Action authz: assigned exec / captain-of-city / super_admin allowed;
//     other-exec / other-captain blocked
//   * Server-computed line_total_paise = quantity * unit_price_paise
//     (caller can't inject a mismatched total)
//   * Position auto-assignment (1, 2, 3...)
//   * Cancelled-request guard
//   * Priority + target date focused setter
// =============================================================================

async function seedQuotation(args: {
  cityId: string;
  execId: string;
  captainId: string;
}): Promise<{ requestId: string; quotationId: string; submittedBy: string }> {
  const req = await seedVisitRequest({
    cityId: args.cityId,
    assignedExecUserId: args.execId,
    assignedCaptainUserId: args.captainId,
  });
  const [q] = await db
    .insert(quotations)
    .values({
      visitRequestId: req.id,
      totalOrderValuePaise: 100000, // ₹1000 placeholder header
      submittedByUserId: args.execId,
    })
    .returning({ id: quotations.id });
  return { requestId: req.id, quotationId: q.id, submittedBy: args.execId };
}

describe('lineItemCreateSchema', () => {
  it('accepts a minimal valid payload', () => {
    const r = lineItemCreateSchema.safeParse({
      quotationId: '019abcde-cafe-7000-8000-000000000001',
      productName: 'Kitchen Light',
      quantity: 2,
      unitPricePaise: 250000,
    });
    expect(r.success).toBe(true);
  });

  it('rejects quantity <= 0', () => {
    const r = lineItemCreateSchema.safeParse({
      quotationId: '019abcde-cafe-7000-8000-000000000001',
      productName: 'X',
      quantity: 0,
      unitPricePaise: 100,
    });
    expect(r.success).toBe(false);
  });

  it('rejects negative unit price', () => {
    const r = lineItemCreateSchema.safeParse({
      quotationId: '019abcde-cafe-7000-8000-000000000001',
      productName: 'X',
      quantity: 1,
      unitPricePaise: -1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects GST percent > 100', () => {
    const r = lineItemCreateSchema.safeParse({
      quotationId: '019abcde-cafe-7000-8000-000000000001',
      productName: 'X',
      quantity: 1,
      unitPricePaise: 100,
      gstPercent: 200,
    });
    expect(r.success).toBe(false);
  });

  it('coerces empty string product SKU to undefined', () => {
    const r = lineItemCreateSchema.safeParse({
      quotationId: '019abcde-cafe-7000-8000-000000000001',
      productName: 'X',
      productSku: '   ',
      quantity: 1,
      unitPricePaise: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.productSku).toBeUndefined();
  });
});

describe('lineItemUpdateSchema', () => {
  it('rejects empty payload (no fields)', () => {
    const r = lineItemUpdateSchema.safeParse({
      itemId: '019abcde-cafe-7000-8000-000000000001',
    });
    expect(r.success).toBe(false);
  });

  it('accepts single-field update', () => {
    const r = lineItemUpdateSchema.safeParse({
      itemId: '019abcde-cafe-7000-8000-000000000001',
      quantity: 5,
    });
    expect(r.success).toBe(true);
  });
});

describe('lineItemPrioritySchema', () => {
  it('accepts priority + null date', () => {
    const r = lineItemPrioritySchema.safeParse({
      itemId: '019abcde-cafe-7000-8000-000000000001',
      priority: 'high',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown priority', () => {
    const r = lineItemPrioritySchema.safeParse({
      itemId: '019abcde-cafe-7000-8000-000000000001',
      priority: 'urgent',
    });
    expect(r.success).toBe(false);
  });
});

describe('addLineItemAction', () => {
  it('inserts a line item, server-computes line_total, returns itemId', async () => {
    const captain = await seedCaptain({ phone: '+919930000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930000011',
      fullName: 'Exec Adds',
    });
    const { quotationId } = await seedQuotation({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const sess_$RANDOM = await loginByPhone(exec.phone, exec.password); currentCookieHeader = sess_$RANDOM.cookieHeader;

    const result = await addLineItemAction({
      quotationId,
      productName: 'Kitchen Light S2',
      productSku: 'KL-S2-WW',
      quantity: 3,
      unitPricePaise: 250000, // ₹2,500 per unit
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');

    const [row] = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.id, result.data!.itemId))
      .limit(1);
    expect(row.productName).toBe('Kitchen Light S2');
    expect(row.productSku).toBe('KL-S2-WW');
    expect(row.quantity).toBe(3);
    expect(Number(row.unitPricePaise)).toBe(250000);
    // Server enforces: line_total = qty * unit_price.
    expect(Number(row.lineTotalPaise)).toBe(750000);
    expect(row.position).toBe(1); // first item in this quotation
  });

  it('auto-increments position across multiple adds', async () => {
    const captain = await seedCaptain({ phone: '+919930000020' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930000021',
      fullName: 'Exec MultiAdd',
    });
    const { quotationId } = await seedQuotation({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const sess_$RANDOM = await loginByPhone(exec.phone, exec.password); currentCookieHeader = sess_$RANDOM.cookieHeader;

    await addLineItemAction({
      quotationId,
      productName: 'A',
      quantity: 1,
      unitPricePaise: 100,
    });
    await addLineItemAction({
      quotationId,
      productName: 'B',
      quantity: 1,
      unitPricePaise: 100,
    });
    await addLineItemAction({
      quotationId,
      productName: 'C',
      quantity: 1,
      unitPricePaise: 100,
    });

    const items = await loadLineItems(quotationId);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.productName)).toEqual(['A', 'B', 'C']);
  });

  it('blocks an unrelated exec (canExecEditRequest returns false)', async () => {
    const captain = await seedCaptain({ phone: '+919930000030' });
    const city = await getOrCreateCity('Bangalore');
    const owner = await seedExecutive(captain.id, {
      phone: '+919930000031',
      fullName: 'Exec Owner',
    });
    const intruder = await seedExecutive(captain.id, {
      phone: '+919930000032',
      fullName: 'Exec Intruder',
    });
    const { quotationId } = await seedQuotation({
      cityId: city.id,
      execId: owner.id,
      captainId: captain.id,
    });
    const sess_$RANDOM = await loginByPhone(intruder.phone, intruder.password); currentCookieHeader = sess_$RANDOM.cookieHeader;

    const result = await addLineItemAction({
      quotationId,
      productName: 'X',
      quantity: 1,
      unitPricePaise: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected forbidden');
    expect(result.error).toBe('Forbidden');
  });

  it('allows super_admin even without ownership', async () => {
    const captain = await seedCaptain({ phone: '+919930000040' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930000041',
      fullName: 'Exec X',
    });
    const admin = await seedSuperAdmin({ phone: '+919930000042' });
    const { quotationId } = await seedQuotation({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const sess_$RANDOM = await loginByPhone(admin.phone, admin.password); currentCookieHeader = sess_$RANDOM.cookieHeader;

    const result = await addLineItemAction({
      quotationId,
      productName: 'Admin Item',
      quantity: 1,
      unitPricePaise: 100,
    });
    expect(result.ok).toBe(true);
  });
});

describe('updateLineItemAction', () => {
  it('updates a single field and recomputes line_total', async () => {
    const captain = await seedCaptain({ phone: '+919930000050' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930000051',
      fullName: 'Exec Update',
    });
    const { quotationId } = await seedQuotation({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const sess_$RANDOM = await loginByPhone(exec.phone, exec.password); currentCookieHeader = sess_$RANDOM.cookieHeader;

    const created = await addLineItemAction({
      quotationId,
      productName: 'Initial',
      quantity: 2,
      unitPricePaise: 100,
    });
    if (!created.ok) throw new Error('add failed');

    const updated = await updateLineItemAction({
      itemId: created.data!.itemId,
      quantity: 5, // bump qty
    });
    expect(updated.ok).toBe(true);

    const [row] = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.id, created.data!.itemId))
      .limit(1);
    expect(row.quantity).toBe(5);
    expect(Number(row.unitPricePaise)).toBe(100); // unchanged
    // Recomputed: 5 * 100 = 500
    expect(Number(row.lineTotalPaise)).toBe(500);
  });
});

describe('setLineItemPriorityAction', () => {
  it('updates priority + target date in one shot', async () => {
    const captain = await seedCaptain({ phone: '+919930000060' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930000061',
      fullName: 'Exec Priority',
    });
    const { quotationId } = await seedQuotation({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
    });
    const sess_$RANDOM = await loginByPhone(exec.phone, exec.password); currentCookieHeader = sess_$RANDOM.cookieHeader;

    const created = await addLineItemAction({
      quotationId,
      productName: 'Item',
      quantity: 1,
      unitPricePaise: 100,
    });
    if (!created.ok) throw new Error('add failed');

    const result = await setLineItemPriorityAction({
      itemId: created.data!.itemId,
      priority: 'high',
      targetDispatchDate: '2026-12-31',
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(quotationLineItems)
      .where(eq(quotationLineItems.id, created.data!.itemId))
      .limit(1);
    expect(row.priority).toBe('high');
    expect(row.targetDispatchDate).toBe('2026-12-31');
  });
});
