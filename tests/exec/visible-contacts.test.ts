import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  leads,
  requestExecAssignments,
  visitRequests,
} from '@/db/schema';
import { loadExecVisibleContactSet } from '@/lib/exec/visible-contacts';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-73 PR 3: exec contact visibility = captor ∪ currently-assigned ∪
//              historically-reassigned
// =============================================================================

async function seedContact(input: {
  capturedBy: string;
  cityId: string;
  name?: string;
  phone?: string;
}) {
  const phone =
    input.phone ??
    `+9198${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, '0')}`;
  const [row] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: input.name ?? 'Test Contact',
      phone,
      cityId: input.cityId,
      interest: [],
      capturedByUserId: input.capturedBy,
    })
    .returning({ id: leads.id });
  return row.id;
}

describe('loadExecVisibleContactSet — source 1: captor', () => {
  it('returns the captor\'s own contacts with reason "captor"', async () => {
    const cap = await seedCaptain({
      phone: '+919000050001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100050001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100050002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');

    const ownedByA = await seedContact({ capturedBy: execA.id, cityId: city.id });
    const ownedByB = await seedContact({ capturedBy: execB.id, cityId: city.id });

    const setA = await loadExecVisibleContactSet(execA.id);
    expect(setA.ids).toContain(ownedByA);
    expect(setA.ids).not.toContain(ownedByB);
    expect(setA.reasons.get(ownedByA)).toBe('captor');

    const setB = await loadExecVisibleContactSet(execB.id);
    expect(setB.ids).toContain(ownedByB);
    expect(setB.ids).not.toContain(ownedByA);
  });
});

describe('loadExecVisibleContactSet — source 2: current assignment', () => {
  it('surfaces a captor-of-other\'s contact when the viewer holds the request', async () => {
    const cap = await seedCaptain({
      phone: '+919000060001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100060001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100060002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');

    // Exec A captures and the request is later wired to Exec B via
    // contact_id + assigned_exec_user_id = execB. (Avoids a full
    // reassignment trail — that's covered separately below.)
    const contactId = await seedContact({
      capturedBy: execA.id,
      cityId: city.id,
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id,
      statusStageCode: 'ASSIGNED',
    });
    await db
      .update(visitRequests)
      .set({ contactId })
      .where(eq(visitRequests.id, req.id));

    const setB = await loadExecVisibleContactSet(execB.id);
    expect(setB.ids).toContain(contactId);
    expect(setB.reasons.get(contactId)).toBe('assignment');
    // Captor still sees it as captor.
    const setA = await loadExecVisibleContactSet(execA.id);
    expect(setA.reasons.get(contactId)).toBe('captor');
  });
});

describe('loadExecVisibleContactSet — source 3: historical reassignment', () => {
  it('surfaces a contact for a previously-assigned exec after the request was moved on', async () => {
    const cap = await seedCaptain({
      phone: '+919000070001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100070001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100070002',
      fullName: 'Exec B',
    });
    const execC = await seedExecutive(cap.id, {
      phone: '+919100070003',
      fullName: 'Exec C',
    });
    const city = await getOrCreateCity('Bangalore');

    // Captor: A. Request goes A → B → C. After the second move:
    //   - visit_requests.assigned_exec_user_id = C   (source 2 hits C)
    //   - request_exec_assignments rows: (A→B), (B→C)
    //     so A appears as from_exec_user_id; B appears as both.
    const contactId = await seedContact({
      capturedBy: execA.id,
      cityId: city.id,
      name: 'Reassigned Customer',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      statusStageCode: 'ASSIGNED',
    });
    await db
      .update(visitRequests)
      .set({ contactId })
      .where(eq(visitRequests.id, req.id));

    // request_exec_assignments.reason has a CHECK (length BETWEEN 50 AND 500).
    const longEnough = 'Reassignment between two execs for test purposes.';
    await db.insert(requestExecAssignments).values([
      {
        requestId: req.id,
        fromExecUserId: execA.id,
        toExecUserId: execB.id,
        captainUserId: cap.id,
        reason: `A → B: ${longEnough}`,
      },
      {
        requestId: req.id,
        fromExecUserId: execB.id,
        toExecUserId: execC.id,
        captainUserId: cap.id,
        reason: `B → C: ${longEnough}`,
      },
    ]);
    // Final current state: assigned to C.
    await db
      .update(visitRequests)
      .set({ assignedExecUserId: execC.id })
      .where(eq(visitRequests.id, req.id));

    const visA = await loadExecVisibleContactSet(execA.id);
    const visB = await loadExecVisibleContactSet(execB.id);
    const visC = await loadExecVisibleContactSet(execC.id);

    expect(visA.ids).toContain(contactId);
    expect(visA.reasons.get(contactId)).toBe('captor');
    expect(visB.ids).toContain(contactId);
    expect(visB.reasons.get(contactId)).toBe('assignment');
    expect(visC.ids).toContain(contactId);
    expect(visC.reasons.get(contactId)).toBe('assignment');
  });

  it('does not leak a contact to an unrelated exec on the same team', async () => {
    const cap = await seedCaptain({
      phone: '+919000080001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100080001',
      fullName: 'Exec A',
    });
    const execX = await seedExecutive(cap.id, {
      phone: '+919100080002',
      fullName: 'Exec X (unrelated)',
    });
    const city = await getOrCreateCity('Bangalore');

    const contactId = await seedContact({
      capturedBy: execA.id,
      cityId: city.id,
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      statusStageCode: 'ASSIGNED',
    });
    await db
      .update(visitRequests)
      .set({ contactId })
      .where(eq(visitRequests.id, req.id));

    const setX = await loadExecVisibleContactSet(execX.id);
    expect(setX.ids).not.toContain(contactId);
  });
});
