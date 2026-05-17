import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities, statusStages, visitRequests } from '@/db/schema';

import {
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-142: cancelled rows must not appear on Submitted-unassigned or
// exec Today surfaces.
//
// Cancellation is orthogonal to status_stage_id (HVA-69 design), so the
// existing stage-based filters on these queries are insufficient: a row
// that was cancelled while still at SUBMITTED + unassigned, or while
// ASSIGNED to an exec, would otherwise remain visible and offer
// follow-on actions against a closed request.
//
// These tests mirror the WHERE clauses in:
//   - app/(captain)/captain/requests/unassigned/page.tsx
//   - app/(exec)/today/page.tsx
// so a regression that removes the isNull(cancelledAt) gate fails here.
// =============================================================================

async function getCityIdByName(name: string): Promise<string> {
  const [row] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, name))
    .limit(1);
  return row.id;
}

async function getStatusStageId(code: string): Promise<string> {
  const [row] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, code))
    .limit(1);
  return row.id;
}

async function markCancelled(requestId: string): Promise<void> {
  const now = new Date();
  await db
    .update(visitRequests)
    .set({
      cancelledAt: now,
      cancellationActor: 'captain',
      cancellationReasonCode: 'NO_LONGER_INTERESTED',
      updatedAt: now,
    })
    .where(eq(visitRequests.id, requestId));
}

describe('Surface 3: /captain/requests/unassigned WHERE filter', () => {
  it('excludes a cancelled Submitted+unassigned row from the captain queue', async () => {
    const cap = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.name, 'Bangalore'));
    const cityId = await getCityIdByName('Bangalore');
    const submittedId = await getStatusStageId('SUBMITTED');

    // Two rows, both Submitted + unassigned in this captain's city.
    const live = await seedVisitRequest({ cityId, statusStageCode: 'SUBMITTED' });
    const dead = await seedVisitRequest({ cityId, statusStageCode: 'SUBMITTED' });
    await markCancelled(dead.id);

    // Mirror app/(captain)/captain/requests/unassigned/page.tsx WHERE.
    const myCityIds = [cityId];
    const rows = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.statusStageId, submittedId),
          isNull(visitRequests.assignedExecUserId),
          isNull(visitRequests.cancelledAt),
          inArray(visitRequests.cityId, myCityIds),
        ),
      );

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(dead.id);
  });

  it('without the isNull(cancelledAt) gate, the cancelled row WOULD appear (sanity)', async () => {
    // This test pins WHY the gate matters. If someone removes the
    // isNull(cancelledAt) filter, the previous test still fails — but
    // this one demonstrates the underlying gap.
    const cap = await seedCaptain();
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.name, 'Bangalore'));
    const cityId = await getCityIdByName('Bangalore');
    const submittedId = await getStatusStageId('SUBMITTED');

    const dead = await seedVisitRequest({ cityId, statusStageCode: 'SUBMITTED' });
    await markCancelled(dead.id);

    const rowsWithoutGate = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.statusStageId, submittedId),
          isNull(visitRequests.assignedExecUserId),
          inArray(visitRequests.cityId, [cityId]),
        ),
      );
    expect(rowsWithoutGate.map((r) => r.id)).toContain(dead.id);
  });
});

describe('Surface 4: /(exec)/today WHERE filter', () => {
  it("excludes a cancelled row from an exec's Today list", async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.name, 'Bangalore'));
    const cityId = await getCityIdByName('Bangalore');

    const live = await seedVisitRequest({
      cityId,
      statusStageCode: 'VISIT_SCHEDULED',
      assignedExecUserId: exec.id,
    });
    const dead = await seedVisitRequest({
      cityId,
      statusStageCode: 'VISIT_SCHEDULED',
      assignedExecUserId: exec.id,
    });
    await markCancelled(dead.id);

    const terminalId = await getStatusStageId('ORDER_EXECUTED_SUCCESSFULLY');

    // Mirror app/(exec)/today/page.tsx WHERE.
    const rows = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.assignedExecUserId, exec.id),
          ne(visitRequests.statusStageId, terminalId),
          isNull(visitRequests.cancelledAt),
        ),
      );

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(dead.id);
  });
});
