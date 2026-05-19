import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, leads, notes } from '@/db/schema';
import { addNoteAction } from '@/lib/notes/actions';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-73 PR 2 + PR 3: addNoteAction tests
// =============================================================================

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

beforeEach(() => {
  currentCookieHeader = undefined;
});

async function setupExecOnAssignedRequest() {
  const cap = await seedCaptain();
  const exec = await seedExecutive(cap.id);
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  const city = await getOrCreateCity('Bangalore');
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    statusStageCode: 'ASSIGNED',
  });
  return { cap, exec, city, requestId: req.id };
}

describe('addNoteAction — auth + validation', () => {
  it('rejects unauthenticated callers', async () => {
    currentCookieHeader = undefined;
    const res = await addNoteAction({
      targetType: 'request',
      targetId: '00000000-0000-7000-8000-000000000000',
      body: 'Should be blocked',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign/i);
  });

  it('rejects an empty body (after trim)', async () => {
    const { requestId } = await setupExecOnAssignedRequest();
    const res = await addNoteAction({
      targetType: 'request',
      targetId: requestId,
      body: '   ',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/empty/i);
  });

  it('rejects a body longer than 2000 chars', async () => {
    const { requestId } = await setupExecOnAssignedRequest();
    const huge = 'x'.repeat(2001);
    const res = await addNoteAction({
      targetType: 'request',
      targetId: requestId,
      body: huge,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/2000/);
  });

  it('rejects when canWriteNoteForEntity returns false', async () => {
    // exec A is on the team but not assigned to this request → strict
    // D2 says no write access. The action mirrors the same gate.
    const cap = await seedCaptain();
    const execA = await seedExecutive(cap.id, {
      phone: '+919101000001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919101000002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      statusStageCode: 'ASSIGNED',
    });
    const sessB = await loginByPhone(execB.phone, execB.password);
    currentCookieHeader = sessB.cookieHeader;

    const res = await addNoteAction({
      targetType: 'request',
      targetId: req.id,
      body: 'Should be blocked',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not allowed/i);
  });

  it('rejects an unknown target id', async () => {
    const { exec } = await setupExecOnAssignedRequest();
    void exec;
    const res = await addNoteAction({
      targetType: 'contact',
      targetId: '00000000-0000-7000-8000-000000000111',
      body: 'Pointing at nothing',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found/i);
  });
});

describe('addNoteAction — happy path', () => {
  it('inserts a note + writes a note_created audit row + returns the note', async () => {
    const { exec, requestId } = await setupExecOnAssignedRequest();
    const res = await addNoteAction({
      targetType: 'request',
      targetId: requestId,
      body: 'Customer asked to reschedule to next Saturday.',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.note.body).toBe(
      'Customer asked to reschedule to next Saturday.',
    );
    expect(res.note.authorUserId).toBe(exec.id);

    const [row] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, res.note.id))
      .limit(1);
    expect(row.body).toBe('Customer asked to reschedule to next Saturday.');
    expect(row.targetType).toBe('request');
    expect(row.targetId).toBe(requestId);
    expect(row.createdByUserId).toBe(exec.id);

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'note_created'),
          eq(auditLog.targetEntityId, requestId),
        ),
      );
    expect(audits.length).toBe(1);
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('noteId', res.note.id);
    expect(after).toHaveProperty('targetType', 'request');
    expect(after).toHaveProperty('bodyLength', 46);
  });

  it('captain on team can write on a team-exec\'s contact', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const city = await getOrCreateCity('Bangalore');
    // Seed a contact owned by the team exec.
    const [contactRow] = await db
      .insert(leads)
      .values({
        type: 'Customer',
        name: 'Team contact',
        phone: '+919876543210',
        cityId: city.id,
        interest: [],
        capturedByUserId: exec.id,
      })
      .returning({ id: leads.id });

    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await addNoteAction({
      targetType: 'contact',
      targetId: contactRow.id,
      body: 'Captain coaching note for the team.',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.note.authorRole).toBe('captain');
  });
});
