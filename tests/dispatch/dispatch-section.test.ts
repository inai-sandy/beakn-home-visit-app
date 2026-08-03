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
import {
  loadDispatchQueue,
  loadDispatchQueueSummary,
} from '@/lib/support/dispatch-queries';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-308: exec / captain Dispatch section
// =============================================================================
//
// The risk this covers is a privacy one: the queue was built for support,
// who are a global pool and see every order. Bolting exec and captain onto
// it means the scope predicate is the only thing stopping one exec seeing
// another's customers.
// =============================================================================

let phoneSeq = 0;
function nextPhone(prefix: string): string {
  phoneSeq += 1;
  return `+91${prefix}${String(phoneSeq).padStart(5, '0')}`;
}

async function seedSupportUser(): Promise<{ phone: string; password: string }> {
  const phone = nextPhone('99081');
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Section Test Support',
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

async function seedOrderFor(opts: {
  execId: string;
  captainId: string;
  cityId: string;
  productName: string;
  qty: number;
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
      productSku: null,
      quantity: opts.qty,
      unitPricePaise: 100000,
      lineTotalPaise: 100000 * opts.qty,
      priority: 'med',
      targetDispatchDate: null,
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, lineItemId: li.id };
}

/** Two execs under one captain, each with an outstanding order. */
async function seedTwoExecs() {
  const city = await getOrCreateCity(`Section City ${phoneSeq}`);
  const captain = await seedCaptain({ phone: nextPhone('99082') });
  const execA = await seedExecutive(captain.id, { phone: nextPhone('99083') });
  const execB = await seedExecutive(captain.id, { phone: nextPhone('99084') });

  const orderA = await seedOrderFor({
    execId: execA.id,
    captainId: captain.id,
    cityId: city.id,
    productName: 'Alpha Light',
    qty: 5,
  });
  const orderB = await seedOrderFor({
    execId: execB.id,
    captainId: captain.id,
    cityId: city.id,
    productName: 'Beta Motor',
    qty: 3,
  });

  return { city, captain, execA, execB, orderA, orderB };
}

describe('exec scoping', () => {
  it('shows only the exec their own outstanding products', async () => {
    const s = await seedTwoExecs();

    const { rows } = await loadDispatchQueue({
      scope: { kind: 'exec', execUserId: s.execA.id },
      pageSize: 100,
    });

    const products = rows.map((r) => r.productName);
    expect(products).toContain('Alpha Light');
    // The privacy assertion — exec B's customer must not leak.
    expect(products).not.toContain('Beta Motor');
  });

  it('gives each exec a summary matching only their own rows', async () => {
    const s = await seedTwoExecs();

    const scope = { kind: 'exec' as const, execUserId: s.execA.id };
    const [{ rows }, summary] = await Promise.all([
      loadDispatchQueue({ scope, pageSize: 100 }),
      loadDispatchQueueSummary({ scope }),
    ]);

    const rowUnits = rows.reduce((sum, r) => sum + r.quantityRemaining, 0);
    expect(summary.unitsPending).toBe(rowUnits);
    expect(summary.ordersPending).toBe(1);
    expect(summary.productsPending).toBe(1);
  });
});

describe('captain scoping', () => {
  it("covers the whole team's outstanding products", async () => {
    const s = await seedTwoExecs();

    const { rows } = await loadDispatchQueue({
      scope: {
        kind: 'captain',
        captainUserId: s.captain.id,
        cityIds: [s.city.id],
        isSuperAdmin: false,
      },
      pageSize: 100,
    });

    const products = rows.map((r) => r.productName);
    expect(products).toContain('Alpha Light');
    expect(products).toContain('Beta Motor');
  });

  it('excludes another captain’s orders', async () => {
    const mine = await seedTwoExecs();
    const theirs = await seedTwoExecs();

    const { rows } = await loadDispatchQueue({
      scope: {
        kind: 'captain',
        captainUserId: mine.captain.id,
        cityIds: [mine.city.id],
        isSuperAdmin: false,
      },
      pageSize: 100,
    });

    const requestIds = rows.map((r) => r.requestId);
    expect(requestIds).toContain(mine.orderA.requestId);
    expect(requestIds).not.toContain(theirs.orderA.requestId);
  });
});

describe('what drops off the list', () => {
  it('removes a product once every unit has shipped', async () => {
    const s = await seedTwoExecs();
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;

    await addDispatchAction({
      items: [{ lineItemId: s.orderA.lineItemId, qty: 5 }],
    });

    const { rows } = await loadDispatchQueue({
      scope: { kind: 'exec', execUserId: s.execA.id },
      pageSize: 100,
    });
    expect(rows.map((r) => r.productName)).not.toContain('Alpha Light');
  });

  it('keeps a partially shipped product, with the remainder pending', async () => {
    const s = await seedTwoExecs();
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;

    await addDispatchAction({
      items: [{ lineItemId: s.orderA.lineItemId, qty: 2 }],
    });

    const scope = { kind: 'exec' as const, execUserId: s.execA.id };
    const [{ rows }, summary] = await Promise.all([
      loadDispatchQueue({ scope, pageSize: 100 }),
      loadDispatchQueueSummary({ scope }),
    ]);

    const row = rows.find((r) => r.productName === 'Alpha Light');
    expect(row).toBeDefined();
    expect(row!.quantityTotal).toBe(5);
    expect(row!.quantityRemaining).toBe(3);
    expect(summary.unitsPending).toBe(3);
  });

  it('stays off the list once the shipment is delivered', async () => {
    const s = await seedTwoExecs();
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;

    const created = await addDispatchAction({
      items: [{ lineItemId: s.orderA.lineItemId, qty: 5 }],
    });
    if (!created.ok) throw new Error('dispatch not created');
    for (const toStage of ['packed', 'handed_off', 'delivered'] as const) {
      await advanceDispatchStageAction({
        dispatchId: created.data!.dispatchId,
        toStage,
      });
    }

    const { rows } = await loadDispatchQueue({
      scope: { kind: 'exec', execUserId: s.execA.id },
      pageSize: 100,
    });
    expect(rows.map((r) => r.productName)).not.toContain('Alpha Light');
  });
});

describe('mode filters', () => {
  it('"pending" hides anything already part-shipped', async () => {
    const s = await seedTwoExecs();
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;

    await addDispatchAction({
      items: [{ lineItemId: s.orderA.lineItemId, qty: 2 }],
    });

    const scope = {
      kind: 'captain' as const,
      captainUserId: s.captain.id,
      cityIds: [s.city.id],
      isSuperAdmin: false,
    };

    const pending = await loadDispatchQueue({ scope, mode: 'pending', pageSize: 100 });
    expect(pending.rows.map((r) => r.productName)).toEqual(['Beta Motor']);

    const inProgress = await loadDispatchQueue({
      scope,
      mode: 'in_progress',
      pageSize: 100,
    });
    expect(inProgress.rows.map((r) => r.productName)).toEqual(['Alpha Light']);
  });

  it('summary follows the active mode', async () => {
    const s = await seedTwoExecs();
    const support = await seedSupportUser();
    currentCookieHeader = (
      await loginByPhone(support.phone, support.password)
    ).cookieHeader;

    await addDispatchAction({
      items: [{ lineItemId: s.orderA.lineItemId, qty: 2 }],
    });

    const scope = {
      kind: 'captain' as const,
      captainUserId: s.captain.id,
      cityIds: [s.city.id],
      isSuperAdmin: false,
    };

    // 3 outstanding on Alpha + 3 on Beta = 6 across everything…
    const all = await loadDispatchQueueSummary({ scope, mode: 'all' });
    expect(all.unitsPending).toBe(6);
    expect(all.ordersPending).toBe(2);

    // …but only Beta's 3 are untouched.
    const pending = await loadDispatchQueueSummary({ scope, mode: 'pending' });
    expect(pending.unitsPending).toBe(3);
    expect(pending.ordersPending).toBe(1);
  });
});

describe('support is unaffected', () => {
  it('still sees every order when no scope is passed', async () => {
    const s = await seedTwoExecs();

    const { rows } = await loadDispatchQueue({ pageSize: 200 });
    const requestIds = rows.map((r) => r.requestId);
    expect(requestIds).toContain(s.orderA.requestId);
    expect(requestIds).toContain(s.orderB.requestId);
  });
});
