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
import { summariseFulfilment } from '@/lib/dispatch/fulfilment';
import { loadDispatchQueue } from '@/lib/support/dispatch-queries';
import { loadOrderDetail } from '@/lib/support/order-detail';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-340: an item the customer removed cannot be shipped
// =============================================================================
//
// When a CartPlus edit drops a line item, HVA-280 soft-removes it — the row
// stays, `removed_at` is set, and the schema states the contract: "All reads
// of 'current' line items filter removed_at IS NULL."
//
// The support QUEUE honoured that. The order DETAIL page did not, and neither
// did addDispatchAction — which did not even select the column. A removed item
// keeps a non-zero remaining quantity, so it rendered as an ordinary
// outstanding row, ItemsDispatchTable put it in `dispatchableIds`
// (quantityRemaining > 0), and the Dispatch form worked. Support could ship
// stock against an item nobody is paying for, and nothing anywhere said no.
//
// Every case seeds TWO line items on the same order and removes only one, so
// no assertion can pass merely because a query came back empty.
// =============================================================================

async function seedSupportUser(): Promise<{ phone: string; password: string }> {
  const phone = `+91994200${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportRemoved#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Support Removed',
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

async function setup() {
  const captain = await seedCaptain({ phone: '+919942100001' });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919942100002',
    fullName: 'Exec Removed',
  });
  const support = await seedSupportUser();
  const sess = await loginByPhone(support.phone, support.password);
  currentCookieHeader = sess.cookieHeader;

  const tag = `HVA340-${Math.floor(Math.random() * 1e6)}`;
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
      totalOrderValuePaise: 500000,
      source: 'portal',
      submittedByUserId: exec.id,
    })
    .returning({ id: quotations.id });

  // Both items are identical apart from the removal, so the guard cannot be
  // passing for some incidental reason.
  const [live] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: q.id,
      position: 1,
      productName: `${tag}-live`,
      quantity: 3,
      unitPricePaise: 100000,
      lineTotalPaise: 300000,
    })
    .returning({ id: quotationLineItems.id });

  const [removed] = await db
    .insert(quotationLineItems)
    .values({
      quotationId: q.id,
      position: 2,
      productName: `${tag}-removed`,
      quantity: 5,
      unitPricePaise: 100000,
      lineTotalPaise: 500000,
      // Exactly what handler-order-status-changed.ts writes when CartPlus
      // stops sending an item.
      removedAt: new Date(),
    })
    .returning({ id: quotationLineItems.id });

  return { requestId: req.id, live: live.id, removed: removed.id, tag };
}

describe('HVA-340: the write guard', () => {
  it('refuses to dispatch a removed item, and writes no dispatch row', async () => {
    const { removed } = await setup();

    const result = await addDispatchAction({
      items: [{ lineItemId: removed, qty: 1 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the removed item to be refused');
    expect(result.error).toMatch(/removed/i);

    // The guard has to stop the write, not merely report an error — this is
    // the assertion that stands between the bug and real stock leaving.
    const written = await db
      .select({ id: dispatchItems.id })
      .from(dispatchItems)
      .where(eq(dispatchItems.quotationLineItemId, removed));
    expect(written).toHaveLength(0);
  });

  it('still dispatches the identical item that was NOT removed', async () => {
    const { live } = await setup();
    const result = await addDispatchAction({
      items: [{ lineItemId: live, qty: 1 }],
    });
    // Without this the refusal above could be passing for any other reason.
    expect(result.ok).toBe(true);
  });

  it('refuses the whole dispatch when a removed item rides along with a live one', async () => {
    // The realistic shape: support ticks "select all" and the removed row
    // comes with it. Partial success would ship the removed item silently.
    const { live, removed } = await setup();

    const result = await addDispatchAction({
      items: [
        { lineItemId: live, qty: 1 },
        { lineItemId: removed, qty: 1 },
      ],
    });

    expect(result.ok).toBe(false);
    const writtenLive = await db
      .select({ id: dispatchItems.id })
      .from(dispatchItems)
      .where(eq(dispatchItems.quotationLineItemId, live));
    expect(writtenLive).toHaveLength(0);
  });
});

describe('HVA-340: what the three portals show', () => {
  it('reports nothing outstanding on the removed item, so nothing can tick it', async () => {
    const { requestId, removed, live } = await setup();
    const detail = await loadOrderDetail(requestId);
    if (!detail) throw new Error('expected the order to load');

    const removedRow = detail.items.find((i) => i.id === removed);
    const liveRow = detail.items.find((i) => i.id === live);

    // ItemsDispatchTable gates selection purely on quantityRemaining > 0.
    expect(removedRow?.quantityRemaining).toBe(0);
    expect(removedRow?.removedAt).not.toBeNull();
    // The live item is untouched — 3 ordered, none shipped.
    expect(liveRow?.quantityRemaining).toBe(3);
    expect(liveRow?.removedAt).toBeNull();
  });

  it('keeps the removed item listed, with its ordered quantity intact', async () => {
    // This page is a record (HVA-328 made the same call for cancelled
    // orders). Hiding the row would also orphan any dispatch history that
    // still references it.
    const { requestId, removed } = await setup();
    const detail = await loadOrderDetail(requestId);
    const removedRow = detail?.items.find((i) => i.id === removed);

    expect(removedRow).toBeDefined();
    expect(removedRow?.quantityTotal).toBe(5);
  });

  it('leaves the removed units out of the order header totals', async () => {
    const { requestId } = await setup();
    const detail = await loadOrderDetail(requestId);
    const summary = summariseFulfilment(detail!.items);

    // 3 live units, not 8. The header used to read "0 of 8 units shipped"
    // for an order the customer had cut down to three.
    expect(summary.unitsTotal).toBe(3);
    expect(summary.productsTotal).toBe(1);
  });

  it('keeps the removed item out of the support queue', async () => {
    // Already true before this ticket (HVA-280); pinned so the queue and the
    // detail page cannot drift apart again in the other direction.
    const { tag } = await setup();
    const queue = await loadDispatchQueue({ pageSize: 200 });
    const names = queue.rows.map((r) => r.productName);

    expect(names).toContain(`${tag}-live`);
    expect(names).not.toContain(`${tag}-removed`);
  });
});
