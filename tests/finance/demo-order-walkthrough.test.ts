import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  payments,
  quotations,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';
import { loadFinanceSnapshot } from '@/lib/captain/finance-queries';
import { computeCollectionSummary } from '@/lib/collection-summary';
import {
  getCurrentMonthWindow,
  loadAllExecTargetProgress,
  loadOneExecTargetProgress,
} from '@/lib/exec/target-progress';
import { loadLeaderboard } from '@/lib/leaderboard/queries';
import { loadOrdersCount, loadOrdersValue } from '@/lib/metrics/orders';
import { loadOutstanding } from '@/lib/metrics/outstanding';
import { loadRevenue } from '@/lib/metrics/revenue';
import {
  reportAovTrend,
  reportOrderValueTrend,
  reportOrdersTrend,
} from '@/lib/reports/sales';
import { reportExecOrders } from '@/lib/reports/team';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// Pre-launch finance verification — one demo order book, every surface
// =============================================================================
//
// Sandeep, 2026-08-17, three days before go-live: "re-verify the complete
// finance part for both the captains and sales executives. Create a demo
// order or execute a demo order and try to verify the entire finance."
//
// So this is not a unit test of one function. It builds ONE realistic order
// book and then asks every finance surface in the product what it thinks the
// money is. Where two surfaces answer the same question differently, that is
// the bug — the recurring split-brain failure mode of this codebase, where one
// rule lives in two places with nothing forcing them to agree.
//
// The book (all confirmed today, all Priya's except R1):
//
//   id  quoted     payments (net)            stage             state
//   --  ---------  ------------------------  ----------------  ----------
//   L1  ₹1,20,000  +50,000 +70,000 = 120,000 ORDER_CONFIRMED   paid in full
//   L2  ₹  80,000  +30,000 +5,000 −5,000     ORDER_CONFIRMED   part paid
//                  = 30,000  (+1 voided)
//   C1  ₹  90,000  +10,000                   ORDER_CONFIRMED   CANCELLED
//   O1  ₹  20,000  +25,000                   ORDER_CONFIRMED   overpaid
//   P1  ₹  40,000  none                      QUOTATION_GIVEN   pipeline
//   R1  ₹  60,000  none                      ORDER_CONFIRMED   Rahul's
//
// Every figure below is hand-computed from that table, in paise, and written
// as a literal. No expectation is derived by calling the code under test.
// =============================================================================

const R = (rupees: number) => rupees * 100;

const TODAY = new Date().toISOString().slice(0, 10);
const RANGE = { fromDate: TODAY, toDate: TODAY };

interface Book {
  captainId: string;
  priyaId: string;
  rahulId: string;
  L1: string;
  L2: string;
  C1: string;
  O1: string;
  P1: string;
  R1: string;
}

async function addQuotedRequest(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  quotedPaise: number;
  stageCode: 'ORDER_CONFIRMED' | 'QUOTATION_GIVEN';
  confirmed: boolean;
}): Promise<string> {
  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: opts.stageCode,
  });
  await db.insert(quotations).values({
    visitRequestId: req.id,
    totalOrderValuePaise: opts.quotedPaise,
    // HVA-281: every finance surface counts CartPlus ('portal') actuals only,
    // so a demo order that is not 'portal' would be invisible to all of them
    // and every assertion would pass against an empty set.
    source: 'portal',
    submittedByUserId: opts.execId,
  });
  if (opts.confirmed) {
    // The money surfaces key off the TRANSITION INTO ORDER_CONFIRMED, not the
    // current stage, so this history row is the thing under test.
    const confirmed = await getStatusStage('ORDER_CONFIRMED');
    await db.insert(requestStatusHistory).values({
      requestId: req.id,
      fromStatusStageId: null,
      toStatusStageId: confirmed.id,
      sequenceNumber: confirmed.sequenceNumber,
      transitionOrder: 1,
      changedByUserId: opts.execId,
    });
  }
  return req.id;
}

async function pay(
  requestId: string,
  byUserId: string,
  rupees: number,
  direction: 'inbound' | 'outbound' = 'inbound',
  voided = false,
): Promise<void> {
  await db.insert(payments).values({
    visitRequestId: requestId,
    direction,
    amountPaise: R(rupees),
    paymentDate: TODAY,
    mode: 'UPI',
    recordedByUserId: byUserId,
    voidedAt: voided ? new Date() : null,
    voidedByUserId: voided ? byUserId : null,
    voidedReason: voided ? 'demo: keyed twice' : null,
  });
}

async function buildBook(): Promise<Book> {
  const captain = await seedCaptain({ phone: '+919870000001', fullName: 'Demo Captain' });
  const city = await getOrCreateCity('Hyderabad');
  // Captain finance visibility resolves through cities.captain_user_id. Without
  // this the snapshot short-circuits to all-zeros rather than erroring — see
  // the "captain owning no city" test at the bottom of this file.
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const priya = await seedExecutive(captain.id, {
    phone: '+919870000002',
    fullName: 'Priya Demo',
  });
  const rahul = await seedExecutive(captain.id, {
    phone: '+919870000003',
    fullName: 'Rahul Demo',
  });

  const base = { cityId: city.id, captainId: captain.id };

  const L1 = await addQuotedRequest({
    ...base, execId: priya.id, quotedPaise: R(120_000),
    stageCode: 'ORDER_CONFIRMED', confirmed: true,
  });
  await pay(L1, priya.id, 50_000);
  await pay(L1, captain.id, 70_000); // captain records on the exec's behalf

  const L2 = await addQuotedRequest({
    ...base, execId: priya.id, quotedPaise: R(80_000),
    stageCode: 'ORDER_CONFIRMED', confirmed: true,
  });
  await pay(L2, priya.id, 30_000);
  await pay(L2, priya.id, 5_000);
  await pay(L2, captain.id, 5_000, 'outbound'); // refund
  await pay(L2, priya.id, 99_999, 'inbound', true); // voided — must vanish

  const C1 = await addQuotedRequest({
    ...base, execId: priya.id, quotedPaise: R(90_000),
    stageCode: 'ORDER_CONFIRMED', confirmed: true,
  });
  await pay(C1, priya.id, 10_000);
  await db
    .update(visitRequests)
    .set({ cancelledAt: new Date(), cancellationActor: 'customer' })
    .where(eq(visitRequests.id, C1));

  const O1 = await addQuotedRequest({
    ...base, execId: priya.id, quotedPaise: R(20_000),
    stageCode: 'ORDER_CONFIRMED', confirmed: true,
  });
  await pay(O1, priya.id, 25_000); // overpaid by ₹5,000

  const P1 = await addQuotedRequest({
    ...base, execId: priya.id, quotedPaise: R(40_000),
    stageCode: 'QUOTATION_GIVEN', confirmed: false,
  });

  const R1 = await addQuotedRequest({
    ...base, execId: rahul.id, quotedPaise: R(60_000),
    stageCode: 'ORDER_CONFIRMED', confirmed: true,
  });

  return {
    captainId: captain.id, priyaId: priya.id, rahulId: rahul.id,
    L1, L2, C1, O1, P1, R1,
  };
}

let book: Book;
beforeEach(async () => {
  book = await buildBook();
});

// -----------------------------------------------------------------------------
// 1. The exec's own finance page (captain finance queries, exec self-scope)
// -----------------------------------------------------------------------------

describe('sales exec — /finance snapshot', () => {
  const snapshot = () =>
    loadFinanceSnapshot({
      captainUserId: '',
      isSuperAdmin: false,
      forceExecScope: book.priyaId,
    });

  it('order book = the three live confirmed orders, cancelled excluded', async () => {
    // L1 1,20,000 + L2 80,000 + O1 20,000 = 2,20,000. C1's 90,000 is cancelled.
    const s = await snapshot();
    expect(s.orderBook.totalPaise).toBe(R(220_000));
    expect(s.orderBook.count).toBe(3);
  });

  it('pipeline = the quoted-but-unconfirmed request only', async () => {
    const s = await snapshot();
    expect(s.pipeline.totalPaise).toBe(R(40_000));
    expect(s.pipeline.count).toBe(1);
  });

  it('received nets the refund and ignores the voided row', async () => {
    // L1 1,20,000 + L2 (30,000+5,000−5,000=30,000) + O1 25,000 = 1,75,000.
    // The voided ₹99,999 must not appear. C1's 10,000 is on a cancelled request.
    const s = await snapshot();
    expect(s.receivedPaise).toBe(R(175_000));
  });

  it('outstanding is clamped per request so an overpayment cannot mask a debt', async () => {
    // L1 0 + L2 50,000 + O1 0 (overpaid, floored) + P1 40,000 = 90,000.
    // If the clamp were missing, O1's −5,000 would net off and report 85,000.
    const s = await snapshot();
    expect(s.outstandingPaise).toBe(R(90_000));
    expect(s.outstandingCount).toBe(2);
  });

  it('surfaces the overpayment as a refund liability', async () => {
    const s = await snapshot();
    expect(s.creditsOwedPaise).toBe(R(5_000));
    expect(s.creditsOwedCount).toBe(1);
  });

  it('the four tiles reconcile: quoted + credits = received + outstanding', async () => {
    // The identity the module documents. If any tile drifts, this breaks even
    // when each individual number still looks plausible on screen.
    const s = await snapshot();
    expect(s.totalQuotedPaise + s.creditsOwedPaise).toBe(
      s.receivedPaise + s.outstandingPaise,
    );
  });

  it("does not leak the other exec's order into this exec's book", async () => {
    const s = await snapshot();
    expect(s.totalQuotedPaise).toBe(R(260_000)); // 2,20,000 + 40,000; no R1
  });
});

// -----------------------------------------------------------------------------
// 2. The captain's finance page — same module, team scope
// -----------------------------------------------------------------------------

describe('captain — /captain/finance snapshot', () => {
  const snapshot = () =>
    loadFinanceSnapshot({ captainUserId: book.captainId, isSuperAdmin: false });

  it('sees both execs and reconciles across the whole team', async () => {
    const s = await snapshot();
    // Priya 2,20,000 + Rahul 60,000 = 2,80,000 order book; pipeline 40,000.
    expect(s.orderBook.totalPaise).toBe(R(280_000));
    expect(s.orderBook.count).toBe(4);
    expect(s.pipeline.totalPaise).toBe(R(40_000));
    expect(s.totalQuotedPaise + s.creditsOwedPaise).toBe(
      s.receivedPaise + s.outstandingPaise,
    );
  });

  it('the captain total equals the sum of its execs (no double counting)', async () => {
    const team = await snapshot();
    const priya = await loadFinanceSnapshot({
      captainUserId: '', isSuperAdmin: false, forceExecScope: book.priyaId,
    });
    const rahul = await loadFinanceSnapshot({
      captainUserId: '', isSuperAdmin: false, forceExecScope: book.rahulId,
    });
    expect(team.orderBook.totalPaise).toBe(
      priya.orderBook.totalPaise + rahul.orderBook.totalPaise,
    );
    expect(team.receivedPaise).toBe(priya.receivedPaise + rahul.receivedPaise);
    expect(team.outstandingPaise).toBe(
      priya.outstandingPaise + rahul.outstandingPaise,
    );
  });
});

// -----------------------------------------------------------------------------
// 3. The admin/dashboard money tiles (metrics SSOT)
// -----------------------------------------------------------------------------

describe('metrics SSOT — booked business excludes the cancelled order', () => {
  const scope = () => ({ execUserId: book.priyaId });

  it('orders count', async () => {
    expect(await loadOrdersCount(scope(), RANGE)).toBe(3);
  });

  it('orders value', async () => {
    expect(await loadOrdersValue(scope(), RANGE)).toBe(R(220_000));
  });

  it('outstanding agrees with the finance page for the same exec', async () => {
    const viaMetrics = await loadOutstanding(scope(), RANGE);
    const viaFinance = await loadFinanceSnapshot({
      captainUserId: '', isSuperAdmin: false, forceExecScope: book.priyaId,
    });
    // Two modules, two independent SQL implementations, one question.
    expect(viaMetrics).toBe(viaFinance.outstandingPaise);
    expect(viaMetrics).toBe(R(90_000));
  });

  it('revenue is collected cash — it keeps the cancelled order money', async () => {
    // 1,75,000 on live requests + C1's 10,000 that genuinely arrived = 1,85,000.
    // Deliberately NOT equal to the finance page's Received; see the
    // reconciliation test below, which pins the gap.
    expect(await loadRevenue(scope(), RANGE)).toBe(R(185_000));
  });
});

// -----------------------------------------------------------------------------
// 4. The exec's target meter and the leaderboard
// -----------------------------------------------------------------------------

describe('sales exec — monthly target progress', () => {
  it('counts the same booked value the dashboard does', async () => {
    const window = getCurrentMonthWindow();
    const p = await loadOneExecTargetProgress(book.priyaId, window, R(500_000));
    // MUST equal loadOrdersValue for the same exec. A cancelled order is not
    // booked business (HVA-334) — and that ruling cannot apply to the admin
    // tile but not to the exec's own meter.
    expect(p?.ordersPaise).toBe(R(220_000));
  });

  it('credits net cash to the deal owner, not whoever keyed the payment', async () => {
    const window = getCurrentMonthWindow();
    const p = await loadOneExecTargetProgress(book.priyaId, window, R(500_000));
    // ₹70,000 of L1 and the ₹5,000 refund were recorded BY THE CAPTAIN.
    expect(p?.revenuePaise).toBe(R(185_000));
  });

  it('the roster view agrees with the single-exec view', async () => {
    const window = getCurrentMonthWindow();
    const all = await loadAllExecTargetProgress(window, R(500_000));
    const one = await loadOneExecTargetProgress(book.priyaId, window, R(500_000));
    const mine = all.find((r) => r.execUserId === book.priyaId);
    expect(mine?.ordersPaise).toBe(one?.ordersPaise);
    expect(mine?.revenuePaise).toBe(one?.revenuePaise);
  });
});

describe('leaderboard', () => {
  it('does not credit an exec for an order the customer cancelled', async () => {
    const rows = await loadLeaderboard({
      metric: 'orders',
      window: { mode: 'range', from: TODAY, to: TODAY },
    });
    const priya = rows.find((r) => r.execUserId === book.priyaId);
    // Three live confirmed orders. The leaderboard is the most public finance
    // surface in the product; it must not rank an exec on cancelled business.
    expect(priya?.metricValue).toBe(3);
  });

  it('ranks revenue on net cash', async () => {
    const rows = await loadLeaderboard({
      metric: 'revenue',
      window: { mode: 'range', from: TODAY, to: TODAY },
    });
    const priya = rows.find((r) => r.execUserId === book.priyaId);
    // UNIT: the leaderboard is the one finance surface that reports RUPEES,
    // not paise (deriveMetrics divides by 100, and LeaderboardView feeds the
    // result straight to formatRupees). Pinned here so a future "consistency"
    // change to paise cannot pass without also fixing the view — that pairing
    // is the whole risk, since a 100x money error still renders as a plausible
    // number on screen.
    expect(priya?.metricValue).toBe(185_000);
  });
});

// -----------------------------------------------------------------------------
// 4b. The reports a captain runs on the same book
// -----------------------------------------------------------------------------

describe('reports — orders, order value, AOV, exec table', () => {
  const execScope = () => ({
    scope: { kind: 'exec' as const, execUserId: book.priyaId },
    range: RANGE,
    bucket: 'day' as const,
  });

  it('orders trend counts the live orders only', async () => {
    const r = await reportOrdersTrend(execScope());
    const total = r.rows.reduce((s, row) => s + row.count, 0);
    expect(total).toBe(3);
  });

  it('order value trend sums the live orders only', async () => {
    const r = await reportOrderValueTrend(execScope());
    const total = r.rows.reduce((s, row) => s + row.value, 0);
    expect(total).toBe(R(220_000));
  });

  it('AOV is computed off the corrected value and count', async () => {
    const r = await reportAovTrend(execScope());
    const value = r.rows.reduce((s, row) => s + row.orderValue, 0);
    const count = r.rows.reduce((s, row) => s + row.ordersCount, 0);
    // ₹2,20,000 over 3 orders. With the cancelled order still in, this was
    // ₹3,10,000 over 4 — wrong twice over, and wrong in a way that looks
    // entirely reasonable on screen.
    expect(count).toBe(3);
    expect(Math.round(value / count)).toBe(Math.round(R(220_000) / 3));
  });

  it('the per-exec table agrees with the exec\'s own target meter', async () => {
    const r = await reportExecOrders({
      scope: { kind: 'captain', captainUserId: book.captainId },
      range: RANGE,
    });
    const priya = r.rows.find((row) => row.execUserId === book.priyaId);
    const window = getCurrentMonthWindow();
    const meter = await loadOneExecTargetProgress(book.priyaId, window, R(500_000));
    expect(priya?.ordersCount).toBe(3);
    expect(priya?.orderValuePaise).toBe(meter?.ordersPaise);
  });
});

// -----------------------------------------------------------------------------
// 5. The per-request ledger the exec actually reads on screen
// -----------------------------------------------------------------------------

describe('request detail — collection summary', () => {
  async function summaryFor(requestId: string) {
    const [q] = await db
      .select({ total: quotations.totalOrderValuePaise })
      .from(quotations)
      .where(eq(quotations.visitRequestId, requestId));
    const rows = await db
      .select({
        direction: payments.direction,
        amountPaise: payments.amountPaise,
        voidedAt: payments.voidedAt,
      })
      .from(payments)
      .where(eq(payments.visitRequestId, requestId));
    return computeCollectionSummary(Number(q.total), rows);
  }

  it('part-paid order shows the balance the customer still owes', async () => {
    const s = await summaryFor(book.L2);
    expect(s.inboundPaise).toBe(R(35_000)); // voided ₹99,999 excluded
    expect(s.outboundPaise).toBe(R(5_000));
    expect(s.netReceivedPaise).toBe(R(30_000));
    expect(s.balancePaise).toBe(R(50_000));
    expect(s.isFullyCollected).toBe(false);
    expect(s.isOverpaid).toBe(false);
  });

  it('fully-paid order reads as settled', async () => {
    const s = await summaryFor(book.L1);
    expect(s.balancePaise).toBe(0);
    expect(s.isFullyCollected).toBe(true);
  });

  it('overpaid order tells the exec we owe money back', async () => {
    const s = await summaryFor(book.O1);
    expect(s.isOverpaid).toBe(true);
    expect(s.overpaidPaise).toBe(R(5_000));
    expect(s.balancePaise).toBe(R(-5_000));
  });

  it('the per-request balances sum to the portfolio outstanding', async () => {
    // Bottom-up from the four screens an exec can open, against the one tile.
    const live = await Promise.all(
      [book.L1, book.L2, book.O1, book.P1].map(summaryFor),
    );
    const bottomUp = live.reduce(
      (acc, s) => acc + Math.max(s.balancePaise, 0),
      0,
    );
    const snapshot = await loadFinanceSnapshot({
      captainUserId: '', isSuperAdmin: false, forceExecScope: book.priyaId,
    });
    expect(bottomUp).toBe(snapshot.outstandingPaise);
  });
});

// -----------------------------------------------------------------------------
// 6. Cross-surface agreement — the split-brain guard
// -----------------------------------------------------------------------------

describe('one question must get one answer', () => {
  it('booked value: dashboard tile == exec target meter == captain order book', async () => {
    const window = getCurrentMonthWindow();
    const tile = await loadOrdersValue({ execUserId: book.priyaId }, RANGE);
    const meter = await loadOneExecTargetProgress(book.priyaId, window, R(500_000));
    const page = await loadFinanceSnapshot({
      captainUserId: '', isSuperAdmin: false, forceExecScope: book.priyaId,
    });
    expect(meter?.ordersPaise).toBe(tile);
    expect(page.orderBook.totalPaise).toBe(tile);
  });

  it('order count: dashboard tile == leaderboard', async () => {
    const tile = await loadOrdersCount({ execUserId: book.priyaId }, RANGE);
    const rows = await loadLeaderboard({
      metric: 'orders',
      window: { mode: 'range', from: TODAY, to: TODAY },
    });
    const priya = rows.find((r) => r.execUserId === book.priyaId);
    expect(priya?.metricValue).toBe(tile);
  });

  it('documents where Received and Revenue legitimately differ', async () => {
    // These two are ALLOWED to disagree, but only by the cancelled order's
    // collected cash — and only in that direction. Anything else is a bug.
    // Pinned so a future edit to either module cannot widen the gap silently.
    const revenue = await loadRevenue({ execUserId: book.priyaId }, RANGE);
    const page = await loadFinanceSnapshot({
      captainUserId: '', isSuperAdmin: false, forceExecScope: book.priyaId,
    });
    expect(revenue - page.receivedPaise).toBe(R(10_000)); // exactly C1's payment
  });
});
