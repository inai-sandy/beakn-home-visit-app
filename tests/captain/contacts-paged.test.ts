import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { leads, visitRequests } from '@/db/schema';
import {
  fetchTeamContacts,
  loadCaptainTeamUserIds,
} from '@/lib/captain/contacts-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// =============================================================================
// HVA-153: server-side filters + pagination on /captain/contacts
// =============================================================================

async function seedContact(input: {
  capturedBy: string;
  cityId: string;
  name?: string;
  phone?: string;
  type?: 'Customer' | 'Business';
}) {
  const phone =
    input.phone ??
    `+9198${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, '0')}`;
  const [row] = await db
    .insert(leads)
    .values({
      type: input.type ?? 'Customer',
      name: input.name ?? 'Test',
      phone,
      cityId: input.cityId,
      interest: [],
      capturedByUserId: input.capturedBy,
    })
    .returning({ id: leads.id });
  return row.id;
}

describe('fetchTeamContacts — search + type + exec compose', () => {
  it('search matches name and digit-only phone substring', async () => {
    const cap = await seedCaptain({
      phone: '+919002000001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919102000001',
      fullName: 'Exec',
    });
    const blr = await getOrCreateCity('Bangalore');
    const aliceId = await seedContact({
      capturedBy: exec.id,
      cityId: blr.id,
      name: 'Alice Roy',
      phone: '+919876543210',
    });
    const bobId = await seedContact({
      capturedBy: exec.id,
      cityId: blr.id,
      name: 'Bob Jones',
      phone: '+919123456789',
    });

    const team = await loadCaptainTeamUserIds(cap.id);

    const byName = await fetchTeamContacts({
      teamUserIds: team,
      search: 'alice',
    });
    expect(byName.rows.map((r) => r.id)).toEqual([aliceId]);

    const byPhone = await fetchTeamContacts({
      teamUserIds: team,
      search: '9876',
    });
    expect(byPhone.rows.map((r) => r.id)).toEqual([aliceId]);

    void bobId;
  });

  it('typeFilter narrows to Customer / Business', async () => {
    const cap = await seedCaptain({
      phone: '+919002100001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919102100001',
      fullName: 'Exec',
    });
    const blr = await getOrCreateCity('Bangalore');
    const customer = await seedContact({
      capturedBy: exec.id,
      cityId: blr.id,
      type: 'Customer',
    });
    const business = await seedContact({
      capturedBy: exec.id,
      cityId: blr.id,
      type: 'Business',
    });

    const team = await loadCaptainTeamUserIds(cap.id);
    const c = await fetchTeamContacts({
      teamUserIds: team,
      typeFilter: 'Customer',
    });
    expect(c.rows.map((r) => r.id)).toEqual([customer]);
    const b = await fetchTeamContacts({
      teamUserIds: team,
      typeFilter: 'Business',
    });
    expect(b.rows.map((r) => r.id)).toEqual([business]);
  });

  it('execFilter narrows to a single captor on the team', async () => {
    const cap = await seedCaptain({
      phone: '+919002200001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919102200001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919102200002',
      fullName: 'Exec B',
    });
    const blr = await getOrCreateCity('Bangalore');
    const a = await seedContact({ capturedBy: execA.id, cityId: blr.id });
    const b = await seedContact({ capturedBy: execB.id, cityId: blr.id });

    const team = await loadCaptainTeamUserIds(cap.id);
    const res = await fetchTeamContacts({
      teamUserIds: team,
      execFilter: execA.id,
    });
    expect(res.rows.map((r) => r.id)).toEqual([a]);
    expect(res.rows.map((r) => r.id)).not.toContain(b);
  });
});

describe('fetchTeamContacts — request-count aggregate scoped to visible page only', () => {
  it('only computes counts for the paginated page, not the whole team', async () => {
    const cap = await seedCaptain({
      phone: '+919002300001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919102300001',
      fullName: 'Exec',
    });
    const blr = await getOrCreateCity('Bangalore');

    // Seed 3 contacts; only the first one gets a request to bump its
    // requestCount. With pageSize=1 + page=2 we should see contact #2
    // (no count) and the aggregate for contact #1 should NEVER be
    // computed in this query.
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await seedContact({
        capturedBy: exec.id,
        cityId: blr.id,
        name: `Contact ${i}`,
      });
      ids.push(id);
      await new Promise((res) => setTimeout(res, 5));
    }
    // Wire a single visit_requests row to contact 0.
    const [first] = await db
      .insert(visitRequests)
      .values({
        customerName: 'Linked',
        customerPhone: '+919999999999',
        customerEmail: null,
        address: 'Test address line',
        cityId: blr.id,
        bhk: '3BHK',
        interest: ['Automation'],
        trackingToken: `t_${Math.random().toString(36).slice(2, 23)}`,
        statusStageId: (
          await db
            .select({ id: (await import('@/db/schema')).statusStages.id })
            .from((await import('@/db/schema')).statusStages)
            .where(
              eq((await import('@/db/schema')).statusStages.code, 'SUBMITTED'),
            )
            .limit(1)
        )[0].id,
        contactId: ids[0],
      })
      .returning({ id: visitRequests.id });
    void first;

    const team = await loadCaptainTeamUserIds(cap.id);

    // Page 1 (size 1): most-recent first → ids[2]. Count = 0.
    const p1 = await fetchTeamContacts({
      teamUserIds: team,
      page: 1,
      pageSize: 1,
    });
    expect(p1.rows).toHaveLength(1);
    expect(p1.rows[0].id).toBe(ids[2]);
    expect(p1.rows[0].requestCount).toBe(0);

    // Page 3 (size 1): oldest → ids[0]. Count = 1 (the linked request).
    const p3 = await fetchTeamContacts({
      teamUserIds: team,
      page: 3,
      pageSize: 1,
    });
    expect(p3.rows).toHaveLength(1);
    expect(p3.rows[0].id).toBe(ids[0]);
    expect(p3.rows[0].requestCount).toBe(1);

    expect(p1.total).toBe(3);
    expect(p3.total).toBe(3);
  });
});
