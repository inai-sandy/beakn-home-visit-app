import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { leads, notes, visitRequests } from '@/db/schema';
import {
  canWriteNoteForEntity,
  loadNotesForEntity,
} from '@/lib/notes/queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-73 PR 2 + PR 3: notes queries + write-auth tests
// =============================================================================

async function seedContact(input: {
  capturedBy: string;
  cityId: string;
  name?: string;
}) {
  const [row] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: input.name ?? 'Test',
      phone: `+9198${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, '0')}`,
      cityId: input.cityId,
      interest: [],
      capturedByUserId: input.capturedBy,
    })
    .returning({ id: leads.id });
  return row.id;
}

async function seedNote(input: {
  targetType: 'request' | 'contact';
  targetId: string;
  authorId: string;
  body: string;
}) {
  const [row] = await db
    .insert(notes)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      body: input.body,
      createdByUserId: input.authorId,
    })
    .returning({ id: notes.id });
  return row.id;
}

describe('loadNotesForEntity', () => {
  it('returns notes in desc order by createdAt with joined author info', async () => {
    const cap = await seedCaptain({
      phone: '+919000600001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100600001',
      fullName: 'Ravi Kumar',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });

    const first = await seedNote({
      targetType: 'request',
      targetId: req.id,
      authorId: exec.id,
      body: 'First note',
    });
    // Force a tiny delay so created_at differs.
    await new Promise((r) => setTimeout(r, 15));
    const second = await seedNote({
      targetType: 'request',
      targetId: req.id,
      authorId: exec.id,
      body: 'Second note (newer)',
    });

    const rows = await loadNotesForEntity('request', req.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(second);
    expect(rows[1].id).toBe(first);
    expect(rows[0].authorName).toBe('Ravi Kumar');
    expect(rows[0].authorRole).toBe('sales_executive');
  });

  it('returns an empty array when no notes exist', async () => {
    const cap = await seedCaptain({
      phone: '+919000610001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100610001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const rows = await loadNotesForEntity('request', req.id);
    expect(rows).toEqual([]);
  });

  it('filters by targetType so request and contact notes don\'t bleed', async () => {
    const cap = await seedCaptain({
      phone: '+919000620001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100620001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const contactId = await seedContact({
      capturedBy: exec.id,
      cityId: city.id,
      name: 'Other contact',
    });

    await seedNote({
      targetType: 'request',
      targetId: req.id,
      authorId: exec.id,
      body: 'Request note',
    });
    await seedNote({
      targetType: 'contact',
      targetId: contactId,
      authorId: exec.id,
      body: 'Contact note',
    });

    const reqRows = await loadNotesForEntity('request', req.id);
    const contactRows = await loadNotesForEntity('contact', contactId);
    expect(reqRows.map((r) => r.body)).toEqual(['Request note']);
    expect(contactRows.map((r) => r.body)).toEqual(['Contact note']);
  });
});

describe('canWriteNoteForEntity — super_admin', () => {
  it('always returns true', async () => {
    const sa = await seedSuperAdmin();
    const cap = await seedCaptain({
      phone: '+919000700001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100700001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    const contactId = await seedContact({
      capturedBy: exec.id,
      cityId: city.id,
    });

    expect(
      await canWriteNoteForEntity(
        { id: sa.id, role: 'super_admin' },
        'request',
        req.id,
      ),
    ).toBe(true);
    expect(
      await canWriteNoteForEntity(
        { id: sa.id, role: 'super_admin' },
        'contact',
        contactId,
      ),
    ).toBe(true);
  });
});

describe('canWriteNoteForEntity — sales_executive', () => {
  it('true on a request the exec is currently assigned to', async () => {
    const cap = await seedCaptain({
      phone: '+919000710001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100710001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(
      await canWriteNoteForEntity(
        { id: exec.id, role: 'sales_executive' },
        'request',
        req.id,
      ),
    ).toBe(true);
  });

  it('false on a request the exec is NOT assigned to', async () => {
    const cap = await seedCaptain({
      phone: '+919000720001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100720001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100720002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(
      await canWriteNoteForEntity(
        { id: execB.id, role: 'sales_executive' },
        'request',
        req.id,
      ),
    ).toBe(false);
  });

  it('true on a contact the exec captured', async () => {
    const cap = await seedCaptain({
      phone: '+919000730001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100730001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const contactId = await seedContact({
      capturedBy: exec.id,
      cityId: city.id,
    });
    expect(
      await canWriteNoteForEntity(
        { id: exec.id, role: 'sales_executive' },
        'contact',
        contactId,
      ),
    ).toBe(true);
  });

  it('false on a contact the exec didn\'t capture and isn\'t assigned to via any request', async () => {
    const cap = await seedCaptain({
      phone: '+919000740001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100740001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100740002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const contactId = await seedContact({
      capturedBy: execA.id,
      cityId: city.id,
    });
    expect(
      await canWriteNoteForEntity(
        { id: execB.id, role: 'sales_executive' },
        'contact',
        contactId,
      ),
    ).toBe(false);
  });
});

describe('canWriteNoteForEntity — captain', () => {
  it('true on a request whose assigned exec is on the captain\'s team', async () => {
    const cap = await seedCaptain({
      phone: '+919000750001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100750001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: cap.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(
      await canWriteNoteForEntity(
        { id: cap.id, role: 'captain' },
        'request',
        req.id,
      ),
    ).toBe(true);
  });

  it('false on a request that belongs to a different team', async () => {
    const capA = await seedCaptain({
      phone: '+919000760001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000760002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919100760001',
      fullName: 'Exec A',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      assignedCaptainUserId: capA.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(
      await canWriteNoteForEntity(
        { id: capB.id, role: 'captain' },
        'request',
        req.id,
      ),
    ).toBe(false);
  });

  it('true on a contact whose captor is on the captain\'s team', async () => {
    const cap = await seedCaptain({
      phone: '+919000770001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100770001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const contactId = await seedContact({
      capturedBy: exec.id,
      cityId: city.id,
    });
    expect(
      await canWriteNoteForEntity(
        { id: cap.id, role: 'captain' },
        'contact',
        contactId,
      ),
    ).toBe(true);
  });

  it('false on a contact captured by another team\'s exec', async () => {
    const capA = await seedCaptain({
      phone: '+919000780001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000780002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919100780001',
      fullName: 'Exec A',
    });
    const city = await getOrCreateCity('Bangalore');
    const contactId = await seedContact({
      capturedBy: execA.id,
      cityId: city.id,
    });
    expect(
      await canWriteNoteForEntity(
        { id: capB.id, role: 'captain' },
        'contact',
        contactId,
      ),
    ).toBe(false);
  });
});

describe('canWriteNoteForEntity — unknown entities', () => {
  it('returns false for a missing request id (captain path)', async () => {
    const cap = await seedCaptain({
      phone: '+919000790001',
      fullName: 'Cap',
    });
    void cap; // helper-side seeding only — no need to thread through.
    expect(
      await canWriteNoteForEntity(
        { id: cap.id, role: 'captain' },
        'request',
        '00000000-0000-7000-8000-000000000000',
      ),
    ).toBe(false);
    // visit_requests fk usage above — keep the eq import alive so lint
    // doesn't trim the helper.
    void eq;
    void visitRequests;
  });
});
