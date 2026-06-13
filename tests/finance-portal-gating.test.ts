import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { quotations, requestStatusHistory } from '@/db/schema';
import { loadMetrics } from '@/lib/metrics/registry';
import { singleDayRange } from '@/lib/metrics/types';
import { getIstDateString } from '@/lib/today/time';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from './helpers/db';

// =============================================================================
// HVA-281: finance counts CartPlus (portal) quotations only
// =============================================================================
//
// A manual quotation is a TARGET — it must never enter money math. Only
// source='portal' quotations (the CartPlus actuals) count toward Booked
// (orders_value), Quotations value, and Outstanding.
// =============================================================================

const istToday = getIstDateString();

async function confirmedRequestWithQuotation(
  suffix: string,
  source: 'manual' | 'portal',
) {
  const captain = await seedCaptain({ phone: `+9190501${suffix}` });
  const city = await getOrCreateCity('Hyderabad');
  const exec = await seedExecutive(captain.id, { phone: `+9191501${suffix}` });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    statusStageCode: 'SUBMITTED',
  });

  await db.insert(quotations).values({
    visitRequestId: req.id,
    totalOrderValuePaise: 4_000_000,
    submittedByUserId: exec.id,
    source,
  });

  const from = await getStatusStage('SUBMITTED');
  const confirmed = await getStatusStage('ORDER_CONFIRMED');
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: from.id,
    toStatusStageId: confirmed.id,
    sequenceNumber: confirmed.sequenceNumber,
    transitionOrder: 1,
    changedByUserId: exec.id,
  });

  return { execId: exec.id, requestId: req.id };
}

describe('finance gating on source=portal', () => {
  it('a MANUAL (target) quotation contributes nothing to Booked / Quotations / Outstanding', async () => {
    const { execId } = await confirmedRequestWithQuotation('01', 'manual');
    const m = await loadMetrics(
      ['orders_value', 'quotations_value', 'outstanding'],
      { execUserId: execId },
      singleDayRange(istToday),
    );
    expect(m.orders_value).toBe(0);
    expect(m.quotations_value).toBe(0);
    expect(m.outstanding).toBe(0);
  });

  it('a PORTAL (CartPlus) quotation counts in full', async () => {
    const { execId } = await confirmedRequestWithQuotation('02', 'portal');
    const m = await loadMetrics(
      ['orders_value', 'quotations_value', 'outstanding'],
      { execUserId: execId },
      singleDayRange(istToday),
    );
    expect(m.orders_value).toBe(4_000_000);
    expect(m.quotations_value).toBe(4_000_000);
    expect(m.outstanding).toBe(4_000_000); // no payments yet
  });

  it('flipping a quotation manual→portal makes it start counting', async () => {
    const { execId, requestId } = await confirmedRequestWithQuotation('03', 'manual');
    const before = await loadMetrics(
      ['orders_value'],
      { execUserId: execId },
      singleDayRange(istToday),
    );
    expect(before.orders_value).toBe(0);

    await db
      .update(quotations)
      .set({ source: 'portal' })
      .where(eq(quotations.visitRequestId, requestId));

    const after = await loadMetrics(
      ['orders_value'],
      { execUserId: execId },
      singleDayRange(istToday),
    );
    expect(after.orders_value).toBe(4_000_000);
  });
});
