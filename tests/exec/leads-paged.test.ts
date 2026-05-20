import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { leads, visitRequests } from '@/db/schema';
import { fetchExecLeads } from '@/lib/exec/leads-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// =============================================================================
// HVA-153: server-side filters + pagination on the exec /leads list
// =============================================================================

async function seedContactFor(
  execId: string,
  cityId: string,
  overrides: {
    name?: string;
    phone?: string;
    type?: 'Customer' | 'Business';
  } = {},
) {
  const phone =
    overrides.phone ??
    `+9198${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, '0')}`;
  const [row] = await db
    .insert(leads)
    .values({
      type: overrides.type ?? 'Customer',
      name: overrides.name ?? 'Test',
      phone,
      cityId,
      interest: [],
      capturedByUserId: execId,
    })
    .returning({ id: leads.id });
  return row.id;
}

describe('fetchExecLeads — search + type compose against the visibility set', () => {
  it('search matches name and digit-only phone substring within the captor set', async () => {
    const cap = await seedCaptain({
      phone: '+919003000001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919103000001',
      fullName: 'Exec',
    });
    const otherExec = await seedExecutive(cap.id, {
      phone: '+919103000002',
      fullName: 'Other',
    });
    const blr = await getOrCreateCity('Bangalore');

    const alice = await seedContactFor(exec.id, blr.id, {
      name: 'Alice Roy',
      phone: '+919876543210',
    });
    const bob = await seedContactFor(exec.id, blr.id, {
      name: 'Bob Jones',
      phone: '+919123456789',
    });
    // Captor not visible to `exec` → must be excluded even if the
    // search matches.
    const otherAlice = await seedContactFor(otherExec.id, blr.id, {
      name: 'Alice Decoy',
    });

    const byName = await fetchExecLeads({
      execUserId: exec.id,
      search: 'alice',
    });
    const ids = byName.rows.map((r) => r.id);
    expect(ids).toContain(alice);
    expect(ids).not.toContain(otherAlice);

    const byPhone = await fetchExecLeads({
      execUserId: exec.id,
      search: '9876',
    });
    expect(byPhone.rows.map((r) => r.id)).toEqual([alice]);

    void bob;
  });

  it('typeFilter narrows to Customer / Business', async () => {
    const cap = await seedCaptain({
      phone: '+919003100001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919103100001',
      fullName: 'Exec',
    });
    const blr = await getOrCreateCity('Bangalore');
    const customer = await seedContactFor(exec.id, blr.id, {
      type: 'Customer',
    });
    const business = await seedContactFor(exec.id, blr.id, {
      type: 'Business',
    });

    const c = await fetchExecLeads({
      execUserId: exec.id,
      typeFilter: 'Customer',
    });
    expect(c.rows.map((r) => r.id)).toEqual([customer]);
    const b = await fetchExecLeads({
      execUserId: exec.id,
      typeFilter: 'Business',
    });
    expect(b.rows.map((r) => r.id)).toEqual([business]);
  });
});

describe('fetchExecLeads — sort preserves unconverted-first across pagination', () => {
  it('within a page, converted rows sink even when the page boundary splits them', async () => {
    const cap = await seedCaptain({
      phone: '+919003200001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919103200001',
      fullName: 'Exec',
    });
    const blr = await getOrCreateCity('Bangalore');

    // 3 unconverted leads + 2 converted (need a converted_to_request_id
    // value to mark them — we'll set it to a synthetic uuid value since
    // the FK is ON DELETE SET NULL and the column accepts arbitrary
    // uuids for the test's purposes). Actually simpler: insert a real
    // visit_request and reference it.
    const [vrRow] = await db
      .insert(visitRequests)
      .values({
        customerName: 'X',
        customerPhone: '+919999999999',
        customerEmail: null,
        address: 'Address line goes here.',
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
      })
      .returning({ id: visitRequests.id });

    const unconv: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await seedContactFor(exec.id, blr.id, {
        name: `U${i}`,
      });
      unconv.push(id);
      await new Promise((res) => setTimeout(res, 5));
    }
    const conv: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const id = await seedContactFor(exec.id, blr.id, {
        name: `C${i}`,
      });
      await db
        .update(leads)
        .set({ convertedToRequestId: vrRow.id, convertedAt: new Date() })
        .where(eq(leads.id, id));
      conv.push(id);
      await new Promise((res) => setTimeout(res, 5));
    }

    // Page 1 (size 3) should be ALL unconverted (newest first).
    const p1 = await fetchExecLeads({
      execUserId: exec.id,
      page: 1,
      pageSize: 3,
    });
    expect(p1.total).toBe(5);
    expect(p1.rows).toHaveLength(3);
    expect(p1.rows.every((r) => r.convertedToRequestId === null)).toBe(true);

    // Page 2 should be the 2 converted.
    const p2 = await fetchExecLeads({
      execUserId: exec.id,
      page: 2,
      pageSize: 3,
    });
    expect(p2.rows).toHaveLength(2);
    expect(p2.rows.every((r) => r.convertedToRequestId !== null)).toBe(true);

    void unconv;
    void conv;
  });
});
