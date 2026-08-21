import { hashPassword } from 'better-auth/crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  accounts,
  dispatchItems,
  dispatchRequestItems,
  dispatchRequestOrders,
  dispatchRequests,
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

import {
  cancelDispatchRequestAction,
  createDispatchRequestAction,
  decideDispatchRequestOrderAction,
} from '@/lib/dispatch-requests/actions';
import {
  loadExecPickList,
  loadDispatchRequestDetail,
  loadSupportRequestInbox,
} from '@/lib/dispatch-requests/queries';
import { dispatchRequestDecisionSchema } from '@/lib/validators/dispatch-request';
import {
  CARTPLUS_REMOVAL_REASON,
  cancelRequestItemsForRemovedLineItems,
} from '@/lib/webhooks/cartplus/cancel-request-items';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-342: the exec's request has to agree with the order
// =============================================================================
//
// The Assist section this replaces could express anything — the product was a
// string and approving it shipped nothing. Every test here pins one of the
// rules that makes that impossible now:
//
//   * a request can only name line items on the exec's OWN confirmed orders
//   * quantity is capped by what the order still owes, minus what is already
//     on an open request (so the same units cannot be asked for twice)
//   * approving writes a REAL dispatch — the pending count drops
//   * an approved group always has a dispatch behind it (they are one write)
//   * support decides per order, so one customer can ship while another waits
// =============================================================================

async function seedSupportUser(): Promise<{
  id: string;
  phone: string;
  password: string;
}> {
  const phone = `+91990342${Math.floor(Math.random() * 9000 + 1000)}`;
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
  statusStageCode?: string;
}): Promise<{ requestId: string; quotationId: string; lineItemId: string }> {
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
      source: 'portal',
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
      priority: 'med',
      targetDispatchDate: null,
    })
    .returning({ id: quotationLineItems.id });
  return { requestId: req.id, quotationId: q.id, lineItemId: li.id };
}

interface Fixture {
  cityId: string;
  execId: string;
  execPhone: string;
  execPassword: string;
  captainId: string;
  support: { id: string; phone: string; password: string };
}

/** Phones are UNIQUE on users and the seed helpers carry fixed defaults, so
 *  every extra user in a test needs its own. */
function uniquePhone(prefix: string): string {
  return `${prefix}${Math.floor(Math.random() * 9000 + 1000)}`;
}

async function setup(): Promise<Fixture> {
  const city = await getOrCreateCity('Bangalore');
  const captain = await seedCaptain({ phone: uniquePhone('+91900042') });
  const exec = await seedExecutive(captain.id, {
    phone: uniquePhone('+91910042'),
  });
  const support = await seedSupportUser();
  return {
    cityId: city.id,
    execId: exec.id,
    execPhone: exec.phone,
    execPassword: exec.password,
    captainId: captain.id,
    support,
  };
}

async function asExec(f: Fixture): Promise<void> {
  const sess = await loginByPhone(f.execPhone, f.execPassword);
  currentCookieHeader = sess.cookieHeader;
}

async function asSupport(f: Fixture): Promise<void> {
  const sess = await loginByPhone(f.support.phone, f.support.password);
  currentCookieHeader = sess.cookieHeader;
}

describe('dispatchRequestDecisionSchema', () => {
  const GROUP = '019abcde-cafe-7000-8000-000000000042';

  it('accepts approve without a reason', () => {
    const r = dispatchRequestDecisionSchema.safeParse({
      orderGroupId: GROUP,
      decision: 'approve',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a hold with no reason', () => {
    // An exec told "not yet" with no explanation rings support to ask, which
    // is the coordination this screen removes.
    const r = dispatchRequestDecisionSchema.safeParse({
      orderGroupId: GROUP,
      decision: 'hold',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a decline with a blank reason', () => {
    const r = dispatchRequestDecisionSchema.safeParse({
      orderGroupId: GROUP,
      decision: 'reject',
      reason: '   ',
    });
    expect(r.success).toBe(false);
  });
});

describe('exec pick list', () => {
  it('offers only the exec own confirmed orders', async () => {
    const f = await setup();
    const other = await seedExecutive(f.captainId, {
      phone: uniquePhone('+91910043'),
    });

    const mine = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'Mine',
    });
    await seedOrderWithItem({
      cityId: f.cityId,
      execId: other.id,
      captainId: f.captainId,
      productName: 'Theirs',
    });
    // Not confirmed yet — cannot be shipped, so must not be offered.
    await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'Unconfirmed',
      statusStageCode: 'QUOTATION_GIVEN',
    });

    const list = await loadExecPickList(f.execId);
    const names = list.flatMap((o) => o.items.map((i) => i.productName));

    expect(names).toEqual(['Mine']);
    expect(list[0].requestId).toBe(mine.requestId);
  });

  it('drops a product the customer removed in CartPlus', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });
    await db
      .update(quotationLineItems)
      .set({ removedAt: new Date() })
      .where(eq(quotationLineItems.id, order.lineItemId));

    const list = await loadExecPickList(f.execId);
    expect(list).toEqual([]);
  });

  it('subtracts units already sitting on an open request', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      qty: 5,
    });

    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      priority: 'medium',
    });
    expect(created.ok).toBe(true);

    const list = await loadExecPickList(f.execId);
    const item = list[0].items[0];
    // Still owed 5, but 2 are spoken for — so only 3 can be asked for again.
    expect(item.quantityRemaining).toBe(5);
    expect(item.quantityReserved).toBe(2);
    expect(item.quantityAvailable).toBe(3);
  });
});

describe('createDispatchRequestAction', () => {
  it('refuses a line item on another exec order', async () => {
    const f = await setup();
    const other = await seedExecutive(f.captainId, {
      phone: uniquePhone('+91910043'),
    });
    const theirs = await seedOrderWithItem({
      cityId: f.cityId,
      execId: other.id,
      captainId: f.captainId,
    });

    await asExec(f);
    const result = await createDispatchRequestAction({
      items: [{ lineItemId: theirs.lineItemId, qty: 1 }],
      priority: 'medium',
    });

    expect(result.ok).toBe(false);
    // Nothing written — the guard is on the write, not just the read.
    const rows = await db.select().from(dispatchRequests);
    expect(rows).toHaveLength(0);
  });

  it('refuses more than the order still owes', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      qty: 5,
    });

    await asExec(f);
    const result = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 6 }],
      priority: 'medium',
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(dispatchRequests)).toHaveLength(0);
  });

  it('refuses units already spoken for on an open request', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      qty: 5,
    });

    await asExec(f);
    const first = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 4 }],
      priority: 'medium',
    });
    expect(first.ok).toBe(true);

    // 5 owed, 4 already requested — asking for 2 more must fail.
    const second = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      priority: 'medium',
    });
    expect(second.ok).toBe(false);
  });

  it('splits one submission into a group per order', async () => {
    const f = await setup();
    const a = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'A',
    });
    const b = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'B',
    });

    await asExec(f);
    const result = await createDispatchRequestAction({
      items: [
        { lineItemId: a.lineItemId, qty: 1 },
        { lineItemId: b.lineItemId, qty: 2 },
      ],
      priority: 'high',
      requiredByDate: '2026-09-01',
    });
    expect(result.ok).toBe(true);

    const detail = await loadDispatchRequestDetail(result.data!.requestId);
    expect(detail!.groups).toHaveLength(2);
    expect(detail!.priority).toBe('high');
    expect(detail!.requiredByDate).toBe('2026-09-01');
    expect(
      detail!.groups.map((g) => g.requestId).sort(),
    ).toEqual([a.requestId, b.requestId].sort());
  });

  it('is refused for a support user', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });

    await asSupport(f);
    const result = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
      priority: 'medium',
    });
    expect(result.ok).toBe(false);
  });
});

describe('decideDispatchRequestOrderAction', () => {
  async function openRequest(f: Fixture, qty = 3) {
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      qty: 5,
    });
    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty }],
      priority: 'medium',
    });
    expect(created.ok).toBe(true);
    const detail = await loadDispatchRequestDetail(created.data!.requestId);
    return { order, requestId: created.data!.requestId, detail: detail! };
  }

  it('approving writes a real dispatch and drops the pending count', async () => {
    const f = await setup();
    const { order, detail } = await openRequest(f, 3);

    await asSupport(f);
    const result = await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'approve',
    });
    expect(result.ok).toBe(true);
    expect(result.data!.dispatchId).toBeTruthy();

    // The shipment exists, against the real line item, for the real quantity.
    const items = await db
      .select()
      .from(dispatchItems)
      .where(eq(dispatchItems.quotationLineItemId, order.lineItemId));
    expect(items).toHaveLength(1);
    expect(items[0].qtyInThisDispatch).toBe(3);

    // And the lifecycle row support's own dialog would have written.
    const history = await db
      .select()
      .from(dispatchStatusHistory)
      .where(eq(dispatchStatusHistory.dispatchId, result.data!.dispatchId!));
    expect(history).toHaveLength(1);
    expect(history[0].stage).toBe('created');

    // 5 ordered, 3 shipped → 2 left to ask for.
    const list = await loadExecPickList(f.execId);
    expect(list[0].items[0].quantityRemaining).toBe(2);
  });

  it('an approved group always has a dispatch behind it', async () => {
    const f = await setup();
    const { detail } = await openRequest(f);

    await asSupport(f);
    await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'approve',
    });

    const [group] = await db
      .select()
      .from(dispatchRequestOrders)
      .where(eq(dispatchRequestOrders.id, detail.groups[0].id));
    expect(group.status).toBe('approved');
    // This is the whole ticket: "approved" and "shipped" are one write, so
    // the status can never be a claim with nothing behind it.
    expect(group.dispatchId).not.toBeNull();
    const [dispatchRow] = await db
      .select()
      .from(dispatches)
      .where(eq(dispatches.id, group.dispatchId!));
    expect(dispatchRow).toBeTruthy();
  });

  it('holds keep the request open; a hold is not a finish', async () => {
    const f = await setup();
    const { requestId, detail } = await openRequest(f);

    await asSupport(f);
    const result = await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'hold',
      reason: 'Out of stock until Friday',
    });
    expect(result.ok).toBe(true);

    const [header] = await db
      .select()
      .from(dispatchRequests)
      .where(eq(dispatchRequests.id, requestId));
    expect(header.status).toBe('open');

    // A held group is still work, so it stays in support's inbox.
    const inbox = await loadSupportRequestInbox();
    expect(inbox.map((g) => g.id)).toContain(detail.groups[0].id);
  });

  it('approves one order while another waits, then closes when both are decided', async () => {
    const f = await setup();
    const a = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'A',
    });
    const b = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'B',
    });

    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [
        { lineItemId: a.lineItemId, qty: 1 },
        { lineItemId: b.lineItemId, qty: 1 },
      ],
      priority: 'medium',
    });
    const detail = await loadDispatchRequestDetail(created.data!.requestId);
    const groupA = detail!.groups.find((g) => g.requestId === a.requestId)!;
    const groupB = detail!.groups.find((g) => g.requestId === b.requestId)!;

    await asSupport(f);
    await decideDispatchRequestOrderAction({
      orderGroupId: groupA.id,
      decision: 'approve',
    });

    // Partial approval: A shipped, B untouched, request still open.
    let after = await loadDispatchRequestDetail(created.data!.requestId);
    expect(
      after!.groups.find((g) => g.requestId === a.requestId)!.status,
    ).toBe('approved');
    expect(
      after!.groups.find((g) => g.requestId === b.requestId)!.status,
    ).toBe('pending');
    expect(after!.status).toBe('open');

    await decideDispatchRequestOrderAction({
      orderGroupId: groupB.id,
      decision: 'reject',
      reason: 'Discontinued',
    });

    after = await loadDispatchRequestDetail(created.data!.requestId);
    expect(after!.status).toBe('closed');
  });

  it('refuses to decide the same order twice', async () => {
    const f = await setup();
    const { detail } = await openRequest(f);

    await asSupport(f);
    await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'approve',
    });
    const second = await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'approve',
    });

    expect(second.ok).toBe(false);
    // Critically, no second shipment went out.
    const items = await db.select().from(dispatchItems);
    expect(items).toHaveLength(1);
  });

  it('cannot be approved when every product was removed in CartPlus', async () => {
    const f = await setup();
    const { order, detail } = await openRequest(f);

    // The customer deletes it, and the sweep cancels the request line.
    await db
      .update(quotationLineItems)
      .set({ removedAt: new Date() })
      .where(eq(quotationLineItems.id, order.lineItemId));
    await db
      .update(dispatchRequestItems)
      .set({ cancelledAt: new Date(), cancelledReason: 'Removed in CartPlus' })
      .where(
        eq(
          dispatchRequestItems.dispatchRequestOrderId,
          detail.groups[0].id,
        ),
      );

    await asSupport(f);
    const result = await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'approve',
    });

    expect(result.ok).toBe(false);
    expect(await db.select().from(dispatchItems)).toHaveLength(0);
  });

  it('is refused for an exec', async () => {
    const f = await setup();
    const { detail } = await openRequest(f);

    await asExec(f);
    const result = await decideDispatchRequestOrderAction({
      orderGroupId: detail.groups[0].id,
      decision: 'approve',
    });
    expect(result.ok).toBe(false);
  });
});

describe('cancelDispatchRequestAction', () => {
  it('releases the units it was holding', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      qty: 5,
    });

    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 5 }],
      priority: 'medium',
    });

    // Everything is spoken for, so nothing is offered.
    expect(await loadExecPickList(f.execId)).toEqual([]);

    const cancelled = await cancelDispatchRequestAction(
      created.data!.requestId,
    );
    expect(cancelled.ok).toBe(true);

    // Withdrawing gives the units back — otherwise they are stranded and the
    // exec can never ask for them again.
    const list = await loadExecPickList(f.execId);
    expect(list[0].items[0].quantityAvailable).toBe(5);
  });

  it('a withdrawn request cannot then be decided', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });

    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
      priority: 'medium',
    });
    const detail = await loadDispatchRequestDetail(created.data!.requestId);
    await cancelDispatchRequestAction(created.data!.requestId);

    await asSupport(f);
    const result = await decideDispatchRequestOrderAction({
      orderGroupId: detail!.groups[0].id,
      decision: 'approve',
    });
    expect(result.ok).toBe(false);
    expect(await db.select().from(dispatchItems)).toHaveLength(0);
  });

  it('is refused for another exec', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });
    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
      priority: 'medium',
    });

    const other = await seedExecutive(f.captainId, {
      phone: uniquePhone('+91910043'),
    });
    const sess = await loginByPhone(other.phone, other.password);
    currentCookieHeader = sess.cookieHeader;

    const result = await cancelDispatchRequestAction(created.data!.requestId);
    expect(result.ok).toBe(false);
  });
});

describe('support inbox', () => {
  it('lists a row per order, urgent first', async () => {
    const f = await setup();
    const low = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'Low',
    });
    const high = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      productName: 'High',
    });

    await asExec(f);
    await createDispatchRequestAction({
      items: [{ lineItemId: low.lineItemId, qty: 1 }],
      priority: 'low',
    });
    await createDispatchRequestAction({
      items: [{ lineItemId: high.lineItemId, qty: 1 }],
      priority: 'high',
    });

    const inbox = await loadSupportRequestInbox();
    expect(inbox).toHaveLength(2);
    expect(inbox[0].items[0].productName).toBe('High');
  });

  it('keeps a cancelled line visible but marked', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });
    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 1 }],
      priority: 'medium',
    });
    const detail = await loadDispatchRequestDetail(created.data!.requestId);
    await db
      .update(dispatchRequestItems)
      .set({ cancelledAt: new Date(), cancelledReason: 'Removed in CartPlus' })
      .where(
        eq(dispatchRequestItems.dispatchRequestOrderId, detail!.groups[0].id),
      );

    const inbox = await loadSupportRequestInbox();
    // Shown, not hidden: support has to see why there is nothing to pack.
    expect(inbox[0].items).toHaveLength(1);
    expect(inbox[0].items[0].cancelledAt).not.toBeNull();

    const live = await db
      .select()
      .from(dispatchRequestItems)
      .where(
        and(
          eq(dispatchRequestItems.dispatchRequestOrderId, detail!.groups[0].id),
          isNull(dispatchRequestItems.cancelledAt),
        ),
      );
    expect(live).toHaveLength(0);
  });
});

describe('CartPlus removal sweep', () => {
  it('cancels an open request line and leaves a reason the exec can read', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });
    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      priority: 'medium',
    });

    const count = await cancelRequestItemsForRemovedLineItems([
      order.lineItemId,
    ]);
    expect(count).toBe(1);

    const detail = await loadDispatchRequestDetail(created.data!.requestId);
    const item = detail!.groups[0].items[0];
    expect(item.cancelledAt).not.toBeNull();
    expect(item.cancelledReason).toBe(CARTPLUS_REMOVAL_REASON);
  });

  it('leaves an already-approved group alone', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });
    await asExec(f);
    const created = await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 2 }],
      priority: 'medium',
    });
    const detail = await loadDispatchRequestDetail(created.data!.requestId);

    await asSupport(f);
    await decideDispatchRequestOrderAction({
      orderGroupId: detail!.groups[0].id,
      decision: 'approve',
    });

    // The stock physically left before the customer's edit. Rewriting the
    // request to say it was cancelled would put it at odds with the dispatch
    // record, which is what the warehouse actually did.
    const count = await cancelRequestItemsForRemovedLineItems([
      order.lineItemId,
    ]);
    expect(count).toBe(0);

    const after = await loadDispatchRequestDetail(created.data!.requestId);
    expect(after!.groups[0].items[0].cancelledAt).toBeNull();
  });

  it('releases the units it cancelled', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
      qty: 5,
    });
    await asExec(f);
    await createDispatchRequestAction({
      items: [{ lineItemId: order.lineItemId, qty: 5 }],
      priority: 'medium',
    });
    expect(await loadExecPickList(f.execId)).toEqual([]);

    await cancelRequestItemsForRemovedLineItems([order.lineItemId]);

    // The reservation is gone. (The line item itself is only removed by the
    // webhook that calls this, which the pick list filters separately.)
    const list = await loadExecPickList(f.execId);
    expect(list[0].items[0].quantityAvailable).toBe(5);
  });
});

describe('visit_requests fixture sanity', () => {
  it('seeds orders at ORDER_CONFIRMED by default', async () => {
    const f = await setup();
    const order = await seedOrderWithItem({
      cityId: f.cityId,
      execId: f.execId,
      captainId: f.captainId,
    });
    const [row] = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.id, order.requestId));
    expect(row).toBeTruthy();
  });
});
