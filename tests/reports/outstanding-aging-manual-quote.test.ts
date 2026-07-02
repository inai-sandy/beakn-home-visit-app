import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { quotations } from '@/db/schema';
import { reportOutstandingAging } from '@/lib/reports/geography';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// F3a — HVA-281 regression: manual-quotation contamination in
// reportOutstandingAging (lib/reports/geography.ts)
// =============================================================================
//
// Outstanding aging must only count CartPlus (source='portal') order
// actuals. Manual quotations carry no real order value and, pre-fix,
// inflated the aging buckets with phantom receivables because the join
// to `quotations` had no `source` filter.
// =============================================================================

describe('reportOutstandingAging — manual-quotation contamination', () => {
  it('REGRESSION: a request with only a MANUAL quotation contributes zero outstanding', async () => {
    const captain = await seedCaptain({ phone: '+919400000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919400000002',
      fullName: 'Exec Aging Manual',
    });

    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await db.insert(quotations).values({
      visitRequestId: req.id,
      quotationNumber: 'MANUAL-AGING-1',
      totalOrderValuePaise: 750_000, // ₹7,500 — would be phantom outstanding pre-fix
      source: 'manual',
      submittedByUserId: exec.id,
    });

    const result = await reportOutstandingAging({
      scope: { kind: 'global' },
      range: { fromDate: '2026-01-01', toDate: '2026-12-31' },
    });

    const totalDue = result.rows.reduce((s, r) => s + r.totalDuePaise, 0);
    const totalCount = result.rows.reduce((s, r) => s + r.count, 0);
    expect(totalDue).toBe(0);
    expect(totalCount).toBe(0);
  });

  it('a portal quotation still surfaces its outstanding correctly alongside an ignored manual one', async () => {
    const captain = await seedCaptain({ phone: '+919400000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919400000011',
      fullName: 'Exec Aging Mixed',
    });

    // Manual — must be ignored.
    const manualReq = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await db.insert(quotations).values({
      visitRequestId: manualReq.id,
      quotationNumber: 'MANUAL-AGING-2',
      totalOrderValuePaise: 1_000_000,
      source: 'manual',
      submittedByUserId: exec.id,
    });

    // Portal — must count fully (no payments yet).
    const portalReq = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await db.insert(quotations).values({
      visitRequestId: portalReq.id,
      quotationNumber: 'PORTAL-AGING-1',
      totalOrderValuePaise: 300_000, // ₹3,000
      source: 'portal',
      submittedByUserId: exec.id,
    });

    const result = await reportOutstandingAging({
      scope: { kind: 'global' },
      range: { fromDate: '2026-01-01', toDate: '2026-12-31' },
    });

    const totalDue = result.rows.reduce((s, r) => s + r.totalDuePaise, 0);
    const totalCount = result.rows.reduce((s, r) => s + r.count, 0);
    expect(totalDue).toBe(300_000); // NOT 1_300_000
    expect(totalCount).toBe(1);
  });
});
