import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { payments } from '@/db/schema';
import { loadRevenue } from '@/lib/metrics/revenue';
import {
  loadAdminPaymentTotals,
  loadAdminPaymentsLedger,
} from '@/lib/admin/finance-ledger';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-297: admin finance ledger — calc-integrity regression
// =============================================================================
//
// Pins the reconciliation between the new admin-finance aggregates and the
// SSOT revenue metric, so a future change can't silently let the
// dashboard's "Collected (net)" tile drift from "Gross − Refunds" or from
// the ledger's universe:
//
//   loadRevenue({}, window)  ==  grossInbound − refunds  (loadAdminPaymentTotals)
//
// Also guards that voided + out-of-window payments are excluded from the
// totals and the ledger, and that the direction filter + count are right.
// Per-test TRUNCATE (tests/setup/per-file.ts) keeps the global scope clean.
// =============================================================================

const WINDOW = { fromDate: '2026-06-01', toDate: '2026-06-30' } as const;

async function seedPayment(opts: {
  visitRequestId: string;
  amountPaise: number;
  direction: 'inbound' | 'outbound';
  recordedBy: string;
  paymentDate: string;
  voided?: boolean;
}) {
  await db.insert(payments).values({
    visitRequestId: opts.visitRequestId,
    amountPaise: opts.amountPaise,
    direction: opts.direction,
    mode: 'UPI',
    paymentDate: opts.paymentDate,
    recordedByUserId: opts.recordedBy,
    voidedAt: opts.voided ? new Date() : null,
    voidedByUserId: opts.voided ? opts.recordedBy : null,
  });
}

async function setup() {
  const captain = await seedCaptain({ phone: '+919000900050', fullName: 'LedgerCap' });
  const exec = await seedExecutive(captain.id, {
    phone: '+919100900050',
    fullName: 'LedgerExec',
  });
  const city = await getOrCreateCity('LedgerCity');
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
  });

  // In window: 2 inbound (₹10k + ₹5k), 1 outbound (₹3k).
  await seedPayment({ visitRequestId: req.id, amountPaise: 1000000, direction: 'inbound', recordedBy: exec.id, paymentDate: '2026-06-15' });
  await seedPayment({ visitRequestId: req.id, amountPaise: 500000, direction: 'inbound', recordedBy: exec.id, paymentDate: '2026-06-20' });
  await seedPayment({ visitRequestId: req.id, amountPaise: 300000, direction: 'outbound', recordedBy: exec.id, paymentDate: '2026-06-18' });
  // Excluded: voided (in-window) + out-of-window inbound.
  await seedPayment({ visitRequestId: req.id, amountPaise: 800000, direction: 'inbound', recordedBy: exec.id, paymentDate: '2026-06-10', voided: true });
  await seedPayment({ visitRequestId: req.id, amountPaise: 900000, direction: 'inbound', recordedBy: exec.id, paymentDate: '2026-05-01' });

  return { req };
}

describe('admin finance ledger — reconciliation + exclusions', () => {
  it('Collected (net) == gross − refunds == SSOT revenue, voided & out-of-window excluded', async () => {
    await setup();

    const totals = await loadAdminPaymentTotals(WINDOW);
    expect(totals.grossInboundPaise).toBe(1500000); // 10k + 5k (not 8k voided, not 9k out-of-window)
    expect(totals.refundsPaise).toBe(300000);
    expect(totals.inboundCount).toBe(2);
    expect(totals.outboundCount).toBe(1);

    const net = totals.grossInboundPaise - totals.refundsPaise; // 12k
    const revenue = await loadRevenue({}, WINDOW);
    expect(revenue).toBe(net);
    expect(revenue).toBe(1200000);
  });

  it('ledger lists non-voided in-window payments, with direction filter + pagination', async () => {
    await setup();

    const all = await loadAdminPaymentsLedger({ ...WINDOW, search: '', page: 1, pageSize: 20 });
    expect(all.total).toBe(3); // 2 inbound + 1 outbound; voided & out-of-window excluded
    expect(all.rows).toHaveLength(3);
    expect(all.rows.some((r) => r.amountPaise === 800000)).toBe(false); // voided not present

    const inbound = await loadAdminPaymentsLedger({ ...WINDOW, search: '', page: 1, pageSize: 20, direction: 'inbound' });
    expect(inbound.total).toBe(2);
    expect(inbound.rows.every((r) => r.direction === 'inbound')).toBe(true);

    const outbound = await loadAdminPaymentsLedger({ ...WINDOW, search: '', page: 1, pageSize: 20, direction: 'outbound' });
    expect(outbound.total).toBe(1);

    const page2 = await loadAdminPaymentsLedger({ ...WINDOW, search: '', page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.rows).toHaveLength(1); // 3 rows, 2/page → page 2 has 1
  });
});
