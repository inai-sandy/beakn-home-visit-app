import { describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { payments, quotations, visitRequests } from '@/db/schema';
import { loadMetrics } from '@/lib/metrics/registry';
import { singleDayRange } from '@/lib/metrics/types';
import { getIstDateString } from '@/lib/today/time';

import { getOrCreateCity, seedCaptain, seedExecutive, seedVisitRequest } from '../helpers/db';

// =============================================================================
// HVA-277: outstanding-metric correlation regression
// =============================================================================
//
// Found while walking the redesigned dashboard: `outstanding` returned 0
// for EVERY scope on EVERY portal. Root cause: in a raw sql`` template
// inside a single-table (no-join) SELECT projection, drizzle renders an
// interpolated column (`${visitRequests.id}`) as the bare `"id"` — and
// SQL name scoping resolves a bare `id` inside a correlated subquery to
// the INNER table's own id. The correlation never matched. Fix:
// hand-qualify with `${table}.col`. Joined queries render qualified and
// were never affected (the second test pins that rule).
// =============================================================================

const istToday = getIstDateString();

describe('outstanding with exec scope', () => {
  it('quotation ₹50,000 minus paid ₹12,345 → ₹37,655 (was: always 0)', async () => {
    const captain = await seedCaptain({ phone: '+919000277088' });
    const exec = await seedExecutive(captain.id, { phone: '+919100277088' });
    const city = await getOrCreateCity('Hyderabad');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'SUBMITTED',
    });

    await db.insert(quotations).values({
      visitRequestId: req.id,
      totalOrderValuePaise: 5_000_000,
      submittedByUserId: exec.id,
    });
    await db.insert(payments).values({
      visitRequestId: req.id,
      direction: 'inbound',
      amountPaise: 1_234_500,
      paymentDate: istToday,
      mode: 'UPI',
      recordedByUserId: exec.id,
    });

    const m = await loadMetrics(
      ['outstanding'] as const,
      { execUserId: exec.id },
      singleDayRange(istToday),
    );
    expect(m.outstanding).toBe(3_765_500);
  });

  it('drizzle renders WHERE-context raw-sql columns table-qualified (the rule the fix relies on)', () => {
    const whereCtx = db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        sql`EXISTS (SELECT 1 FROM payments WHERE payments.visit_request_id = ${visitRequests.id})`,
      );
    expect(whereCtx.toSQL().sql).toContain('"visit_requests"."id"');
  });
});
