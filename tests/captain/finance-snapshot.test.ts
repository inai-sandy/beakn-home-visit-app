import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { payments, quotations } from '@/db/schema';
import { loadFinanceSnapshot } from '@/lib/captain/finance-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// 2026-06-04 regression test — Finance dashboard Received + Outstanding
// =============================================================================
//
// Sandeep flagged on prod that the Outstanding tile was under-reporting:
//   - One customer over-paid by ₹23k (Modi: ₹83k against ₹60k quote)
//   - One customer over-paid by ₹2.8k (KCR: ₹52.8k against ₹50k quote)
//   - One customer underpaid by ₹19k (IIT Admin: ₹1k against ₹20k quote)
// Before the fix the tile computed `totalQuoted - received` which let
// the two over-payments cancel ₹25.8k of legitimate outstanding from
// other customers. The bug surfaced as a ₹25.8k under-report.
//
// Separately, Received tile was JOIN-gated on quotations and silently
// dropped pre-quote deposits — the table showed ₹293k, the tile ₹222k,
// a ₹71k mismatch.
//
// This file asserts:
//   1. Outstanding is per-row clamped — over-paid rows don't reduce others'
//   2. Credits owed surfaces over-payment separately + non-negative
//   3. Received counts pre-quote deposits (unquoted requests too)
//   4. Reconciliation: totalQuoted + creditsOwed = received_on_quoted +
//      outstanding (within the quoted slice)
// =============================================================================

async function seedQuotation(
  visitRequestId: string,
  totalPaise: number,
  submittedByUserId: string,
) {
  await db.insert(quotations).values({
    visitRequestId,
    totalOrderValuePaise: totalPaise,
    submittedAt: new Date(),
    submittedByUserId,
  });
}

async function seedPayment(
  visitRequestId: string,
  amountPaise: number,
  direction: 'inbound' | 'outbound',
  recordedBy: string,
) {
  await db.insert(payments).values({
    visitRequestId,
    amountPaise,
    direction,
    mode: 'UPI',
    paymentDate: sql`CURRENT_DATE` as unknown as string,
    recordedByUserId: recordedBy,
  });
}

describe('loadFinanceSnapshot — per-row clamp regression', () => {
  it('over-paid row does not silently cancel another row\'s outstanding', async () => {
    const captain = await seedCaptain({
      phone: '+919000900001',
      fullName: 'FinCap',
    });
    const exec = await seedExecutive(captain.id, {
      phone: '+919100900001',
      fullName: 'FinExec',
    });
    const city = await getOrCreateCity('Bangalore');

    // Request A: underpaid by ₹10k (quoted 25k, paid 15k → owes 10k)
    const a = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await seedQuotation(a.id, 2500000, exec.id);
    await seedPayment(a.id, 1500000, 'inbound', exec.id);

    // Request B: over-paid by ₹5k (quoted 20k, paid 25k → company owes 5k back)
    const b = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await seedQuotation(b.id, 2000000, exec.id);
    await seedPayment(b.id, 2500000, 'inbound', exec.id);

    const snap = await loadFinanceSnapshot({
      captainUserId: captain.id,
      isSuperAdmin: true,
    });

    // Outstanding = 10k (only A), NOT 10k - 5k = 5k.
    expect(snap.outstandingPaise).toBe(1000000);
    expect(snap.outstandingCount).toBe(1);

    // Credits owed = 5k (only B), surfaced separately.
    expect(snap.creditsOwedPaise).toBe(500000);
    expect(snap.creditsOwedCount).toBe(1);

    // Total quoted = 45k.
    expect(snap.totalQuotedPaise).toBe(4500000);

    // Received = 40k (15k + 25k inbound, no refunds).
    expect(snap.receivedPaise).toBe(4000000);

    // Reconciliation: quoted + credits = received + outstanding
    // 45k + 5k = 40k + 10k = 50k.
    expect(snap.totalQuotedPaise + snap.creditsOwedPaise).toBe(
      snap.receivedPaise + snap.outstandingPaise,
    );
  });

  it('refund (outbound payment) nets against inbound on the same request', async () => {
    const captain = await seedCaptain({
      phone: '+919000900002',
      fullName: 'FinCap2',
    });
    const exec = await seedExecutive(captain.id, {
      phone: '+919100900002',
      fullName: 'FinExec2',
    });
    const city = await getOrCreateCity('Chennai');

    // Singham case: quoted 75k, paid 5k inbound + refunded 10k outbound
    // → net paid = -5k, owes the customer 5k back, original 75k still outstanding
    const c = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await seedQuotation(c.id, 7500000, exec.id);
    await seedPayment(c.id, 500000, 'inbound', exec.id);
    await seedPayment(c.id, 1000000, 'outbound', exec.id);

    const snap = await loadFinanceSnapshot({
      captainUserId: captain.id,
      isSuperAdmin: true,
    });

    // Received = 5k - 10k = -5k (yes, can be negative when refunds outpace
    // inbound — this is the captain's net cash position on the request).
    expect(snap.receivedPaise).toBe(-500000);

    // Outstanding = quoted - net_paid = 75k - (-5k) = 80k.
    // The 5k refund INCREASES outstanding because the customer paid in
    // and we gave it back, so they still owe the full 75k PLUS the 5k
    // we returned without applying to invoice.
    expect(snap.outstandingPaise).toBe(8000000);
    expect(snap.creditsOwedPaise).toBe(0);
  });

  it('received tile includes payments on unquoted requests', async () => {
    const captain = await seedCaptain({
      phone: '+919000900003',
      fullName: 'FinCap3',
    });
    const exec = await seedExecutive(captain.id, {
      phone: '+919100900003',
      fullName: 'FinExec3',
    });
    const city = await getOrCreateCity('Hyderabad');

    // Unquoted request with a pre-quote deposit of ₹3k.
    const d = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await seedPayment(d.id, 300000, 'inbound', exec.id);

    // Quoted request: quoted 10k, paid 4k → outstanding 6k.
    const e = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await seedQuotation(e.id, 1000000, exec.id);
    await seedPayment(e.id, 400000, 'inbound', exec.id);

    const snap = await loadFinanceSnapshot({
      captainUserId: captain.id,
      isSuperAdmin: true,
    });

    // Received tile must include the ₹3k pre-quote deposit:
    //   3k (unquoted) + 4k (quoted) = 7k.
    expect(snap.receivedPaise).toBe(700000);
    expect(snap.totalQuotedPaise).toBe(1000000);
    expect(snap.outstandingPaise).toBe(600000);
  });
});
