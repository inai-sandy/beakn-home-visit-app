import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editContactAction } from '@/app/(exec)/leads/_actions/editContact';
import { addLeadAction } from '@/app/(exec)/leads/_actions/addLead';
import { db } from '@/db/client';
import { auditLog, leads } from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// =============================================================================
// HVA-159: editContactAction tests
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

async function seedCustomerContact(execUserId: string, cityId: string, phone = '9885698665') {
  const res = await addLeadAction({
    type: 'Customer',
    name: 'Alice',
    phone,
    cityId,
    interest: ['Automation'],
    bhk: '3BHK',
  });
  if (!res.ok) throw new Error('seedCustomerContact failed');
  return res.data!.leadId;
}

describe('editContactAction — auth', () => {
  it('refuses anonymous callers', async () => {
    currentCookieHeader = undefined;
    const res = await editContactAction({
      contactId: '00000000-0000-7000-8000-000000000000',
      name: 'X',
      firmName: null,
      phone: '9876543210',
      email: null,
      cityId: '00000000-0000-7000-8000-000000000001',
      bhk: '3BHK',
      interest: [],
      businessTypeId: null,
      notes: null,
    });
    expect(res.ok).toBe(false);
  });

  it('refuses an exec who can\'t see the contact', async () => {
    const cap = await seedCaptain();
    const execA = await seedExecutive(cap.id, {
      phone: '+919100300001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100300002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');

    const sessA = await loginByPhone(execA.phone, execA.password);
    currentCookieHeader = sessA.cookieHeader;
    const id = await seedCustomerContact(execA.id, city.id);

    const sessB = await loginByPhone(execB.phone, execB.password);
    currentCookieHeader = sessB.cookieHeader;
    const res = await editContactAction({
      contactId: id,
      name: 'Alice Updated',
      firmName: null,
      phone: '9885698665',
      email: null,
      cityId: city.id,
      bhk: '3BHK',
      interest: ['Automation'],
      businessTypeId: null,
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not visible to you/i);
  });
});

describe('editContactAction — happy path', () => {
  it('updates editable fields and writes a contact_edited audit row with sparse diff', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const id = await seedCustomerContact(exec.id, city.id);

    const res = await editContactAction({
      contactId: id,
      name: 'Alice Updated',
      firmName: null,
      phone: '9885698665',
      email: 'alice@updated.test',
      cityId: city.id,
      bhk: '2BHK',
      interest: ['Automation'],
      businessTypeId: null,
      notes: 'Some notes from edit',
    });
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);

    const [row] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, id))
      .limit(1);
    expect(row.name).toBe('Alice Updated');
    expect(row.email).toBe('alice@updated.test');
    expect(row.bhk).toBe('2BHK');
    expect(row.notes).toBe('Some notes from edit');

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'contact_edited'),
          eq(auditLog.targetEntityId, id),
        ),
      );
    expect(audits.length).toBe(1);
    // Sparse diff: only changed fields present in before/after.
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('name', 'Alice Updated');
    expect(after).toHaveProperty('email', 'alice@updated.test');
    expect(after).toHaveProperty('bhk', '2BHK');
    expect(after).toHaveProperty('notes', 'Some notes from edit');
    // phone wasn't changed → not in the diff
    expect(after).not.toHaveProperty('phone');
  });

  it('no-op when nothing changed — no audit row, changed=false', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const id = await seedCustomerContact(exec.id, city.id);

    const res = await editContactAction({
      contactId: id,
      name: 'Alice',
      firmName: null,
      phone: '9885698665',
      email: null,
      cityId: city.id,
      bhk: '3BHK',
      interest: ['Automation'],
      businessTypeId: null,
      notes: null,
    });
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'contact_edited'),
          eq(auditLog.targetEntityId, id),
        ),
      );
    expect(audits.length).toBe(0);
  });
});

describe('editContactAction — phone collision (D2/D4)', () => {
  it('blocks save when the new phone matches another lead row and does NOT modify the contact', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    // Seed two distinct contacts.
    const a = await seedCustomerContact(exec.id, city.id, '9885698665');
    const b = await seedCustomerContact(exec.id, city.id, '9123456780');

    // Edit B to use A's phone — should collide on A.
    const res = await editContactAction({
      contactId: b,
      name: 'Alice (collision attempt)',
      firmName: null,
      phone: '9885698665',
      email: null,
      cityId: city.id,
      bhk: '3BHK',
      interest: ['Automation'],
      businessTypeId: null,
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/already belongs to contact/i);
      expect(res.collisionContactId).toBe(a);
    }

    // B is unchanged.
    const [bRow] = await db.select().from(leads).where(eq(leads.id, b)).limit(1);
    expect(bRow.phone).toBe('+919123456780');
    expect(bRow.name).toBe('Alice');
  });
});

describe('editContactAction — invalid phone', () => {
  it('rejects malformed phone with a field error', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const id = await seedCustomerContact(exec.id, city.id);

    const res = await editContactAction({
      contactId: id,
      name: 'Alice',
      firmName: null,
      phone: '12345',
      email: null,
      cityId: city.id,
      bhk: '3BHK',
      interest: ['Automation'],
      businessTypeId: null,
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.phone).toBeTruthy();
  });
});
