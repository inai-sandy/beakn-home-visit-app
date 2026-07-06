import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { requestStatusHistory, visitRequests } from '@/db/schema';
import { applyCartplusOrderStatus } from '@/lib/webhooks/cartplus/apply-status';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// Regression: applyCartplusOrderStatus('cancelled', ...) writes a timeline
// history row, matching the customer/staff cancel paths
// =============================================================================
//
// Pre-fix, the 'cancelled' branch only flipped visit_requests.cancelled_at
// + the cancellation_* columns — it never inserted a request_status_history
// row. That broke two things: /track's timeline (which reads history rows
// to render events) never showed the CartPlus-driven cancellation, and any
// history-based cancellation report undercounted CartPlus cancels.
//
// The fix inserts a request_status_history row with the same
// "CANCELLED_BY_CUSTOMER: " prefix the customer-track and CartPlus paths
// share, keeping /track timeline rendering + reporting consistent
// regardless of which surface triggered the cancellation.
// =============================================================================

async function seedConfirmedRequest(): Promise<string> {
  const captain = await seedCaptain({ phone: '+919944000001' });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919944000002',
    fullName: 'Exec CartplusApplyStatus',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  return req.id;
}

describe('applyCartplusOrderStatus — cancelled branch writes timeline history (regression)', () => {
  it('writes a request_status_history row prefixed CANCELLED_BY_CUSTOMER:', async () => {
    const requestId = await seedConfirmedRequest();

    const result = await db.transaction(async (tx) => {
      return applyCartplusOrderStatus(tx, requestId, 'cancelled', null);
    });
    expect(result.cancelled).toBe(true);

    const [request] = await db
      .select({ cancelledAt: visitRequests.cancelledAt })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));
    expect(request!.cancelledAt).not.toBeNull();

    const historyRows = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));

    const cancelRows = historyRows.filter((r) =>
      (r.reason ?? '').startsWith('CANCELLED_BY_CUSTOMER:'),
    );
    expect(cancelRows.length).toBe(1);
  });

  it('is idempotent — a second cancelled call does not insert another history row', async () => {
    const requestId = await seedConfirmedRequest();

    await db.transaction(async (tx) =>
      applyCartplusOrderStatus(tx, requestId, 'cancelled', null),
    );
    const secondResult = await db.transaction(async (tx) =>
      applyCartplusOrderStatus(tx, requestId, 'cancelled', null),
    );
    // Already-cancelled guard returns the NOOP shape.
    expect(secondResult.cancelled).toBe(false);

    const rows = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(
        and(
          eq(requestStatusHistory.requestId, requestId),
        ),
      );
    const cancelRows = rows.filter((r) =>
      (r.reason ?? '').startsWith('CANCELLED_BY_CUSTOMER:'),
    );
    expect(cancelRows.length).toBe(1);
  });
});
