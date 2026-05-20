import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  cities as citiesTable,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { fetchCaptainRequests } from '@/lib/captain/requests-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-153: server-side filters + pagination + bucket counts on
// /captain/requests
// =============================================================================

async function cancelRequest(requestId: string) {
  await db
    .update(visitRequests)
    .set({ cancelledAt: new Date(), cancellationActor: 'customer' })
    .where(eq(visitRequests.id, requestId));
}

async function completeRequest(requestId: string) {
  const [done] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'))
    .limit(1);
  await db
    .update(visitRequests)
    .set({ statusStageId: done.id })
    .where(eq(visitRequests.id, requestId));
}

describe('fetchCaptainRequests — scope + filters compose', () => {
  it('captain only sees requests in their cities', async () => {
    const cap = await seedCaptain({
      phone: '+919001000001',
      fullName: 'Cap',
    });
    const blr = await getOrCreateCity('Bangalore');
    const hyd = await getOrCreateCity('Hyderabad');
    // Captain owns Bangalore only.
    await db
      .update(citiesTable)
      .set({ captainUserId: cap.id })
      .where(eq(citiesTable.id, blr.id));

    const r1 = await seedVisitRequest({ cityId: blr.id });
    const r2 = await seedVisitRequest({ cityId: hyd.id });

    const { rows, total } = await fetchCaptainRequests({
      cityIds: [blr.id],
      isSuperAdmin: false,
      bucket: 'all',
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).not.toContain(r2.id);
    expect(total).toBe(1);
  });

  it('search narrows by customer name and digit-only phone substring', async () => {
    const blr = await getOrCreateCity('Bangalore');
    const r1 = await seedVisitRequest({ cityId: blr.id });
    // Override the seed defaults to make this test deterministic.
    await db
      .update(visitRequests)
      .set({ customerName: 'Alice Roy', customerPhone: '+919876543210' })
      .where(eq(visitRequests.id, r1.id));
    const r2 = await seedVisitRequest({ cityId: blr.id });
    await db
      .update(visitRequests)
      .set({ customerName: 'Bob Jones', customerPhone: '+919123456789' })
      .where(eq(visitRequests.id, r2.id));

    // Name match.
    const byName = await fetchCaptainRequests({
      cityIds: [blr.id],
      isSuperAdmin: false,
      bucket: 'all',
      search: 'alice',
    });
    expect(byName.rows.map((r) => r.id)).toEqual([r1.id]);

    // Phone digits match.
    const byPhone = await fetchCaptainRequests({
      cityIds: [blr.id],
      isSuperAdmin: false,
      bucket: 'all',
      search: '9876',
    });
    expect(byPhone.rows.map((r) => r.id)).toEqual([r1.id]);
  });

  it('execFilter narrows to a single assigned exec', async () => {
    const cap = await seedCaptain({
      phone: '+919001100001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919101100001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919101100002',
      fullName: 'Exec B',
    });
    const blr = await getOrCreateCity('Bangalore');

    const r1 = await seedVisitRequest({
      cityId: blr.id,
      assignedExecUserId: execA.id,
      statusStageCode: 'ASSIGNED',
    });
    const r2 = await seedVisitRequest({
      cityId: blr.id,
      assignedExecUserId: execB.id,
      statusStageCode: 'ASSIGNED',
    });

    const { rows } = await fetchCaptainRequests({
      cityIds: [blr.id],
      isSuperAdmin: false,
      bucket: 'all',
      execFilter: execA.id,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).not.toContain(r2.id);
  });
});

describe('fetchCaptainRequests — pagination preserves sort + caps result size', () => {
  it('returns the requested page slice ordered by created_at DESC', async () => {
    const blr = await getOrCreateCity('Bangalore');
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await seedVisitRequest({ cityId: blr.id });
      ids.push(r.id);
      // Small delay so created_at differs across rows. UUIDv7 also
      // strictly increases, but Drizzle's ORDER BY uses created_at.
      await new Promise((res) => setTimeout(res, 5));
    }

    const page1 = await fetchCaptainRequests({
      cityIds: [blr.id],
      isSuperAdmin: false,
      bucket: 'all',
      page: 1,
      pageSize: 2,
    });
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    // Newest first → last inserted appears first.
    expect(page1.rows[0].id).toBe(ids[4]);
    expect(page1.rows[1].id).toBe(ids[3]);

    const page3 = await fetchCaptainRequests({
      cityIds: [blr.id],
      isSuperAdmin: false,
      bucket: 'all',
      page: 3,
      pageSize: 2,
    });
    expect(page3.rows).toHaveLength(1);
    expect(page3.rows[0].id).toBe(ids[0]);
  });
});

describe('fetchCaptainRequests — bucket counts independent of active bucket', () => {
  it('bucketCounts.* stay the same regardless of which bucket is selected', async () => {
    const blr = await getOrCreateCity('Bangalore');
    // Seed 1 open, 1 assigned, 1 completed, 1 cancelled.
    const open = await seedVisitRequest({ cityId: blr.id });
    const assigned = await seedVisitRequest({
      cityId: blr.id,
      assignedExecUserId: (
        await seedExecutive(
          (
            await seedCaptain({
              phone: '+919001200001',
              fullName: 'Cap-A',
            })
          ).id,
          { phone: '+919101200001', fullName: 'Exec' },
        )
      ).id,
      statusStageCode: 'ASSIGNED',
    });
    const completed = await seedVisitRequest({ cityId: blr.id });
    await completeRequest(completed.id);
    const cancelled = await seedVisitRequest({ cityId: blr.id });
    await cancelRequest(cancelled.id);

    const byBucket: Array<'all' | 'open' | 'assigned' | 'completed' | 'cancelled'> =
      ['all', 'open', 'assigned', 'completed', 'cancelled'];

    const expected = { all: 4, open: 1, assigned: 1, completed: 1, cancelled: 1 };
    for (const b of byBucket) {
      const { bucketCounts } = await fetchCaptainRequests({
        cityIds: [blr.id],
        isSuperAdmin: false,
        bucket: b,
      });
      expect(bucketCounts).toEqual(expected);
    }
    void open;
    void assigned;
  });
});
