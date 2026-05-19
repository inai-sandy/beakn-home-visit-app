import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editContactAction } from '@/app/(exec)/leads/_actions/editContact';
import { editRequestAction } from '@/app/requests/[id]/_actions/editRequest';
import { addLeadAction } from '@/app/(exec)/leads/_actions/addLead';
import { db } from '@/db/client';
import { auditLog, leads } from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-163: server-action tests — captain + super_admin paths added
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

async function asExec(captainPhone: string, execPhone: string) {
  const cap = await seedCaptain({ phone: captainPhone, fullName: 'Cap' });
  const exec = await seedExecutive(cap.id, { phone: execPhone, fullName: 'Exec' });
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  return { cap, exec };
}

async function seedContactWithExec(_execId: string, cityId: string, name = 'Test C') {
  // Caller has already set `currentCookieHeader` to the exec session,
  // so addLeadAction picks them up as the captor via next/headers mock.
  const res = await addLeadAction({
    type: 'Customer',
    name,
    phone: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`,
    cityId,
    interest: ['Automation'],
    bhk: '3BHK',
  });
  if (!res.ok) throw new Error('seed addLead failed');
  return res.data!.leadId;
}

describe('editContactAction — captain role', () => {
  it('captain on team can edit a contact captured by a team exec → ok + audit row with actor_role=captain', async () => {
    const { cap, exec } = await asExec(
      '+919000900001',
      '+919100900001',
    );
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContactWithExec(exec.id, city.id, 'Alice');

    // Switch to captain.
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await editContactAction({
      contactId: id,
      name: 'Alice (captain-edited)',
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

    const [row] = await db
      .select({ name: leads.name })
      .from(leads)
      .where(eq(leads.id, id))
      .limit(1);
    expect(row.name).toBe('Alice (captain-edited)');

    const audits = await db
      .select({
        eventType: auditLog.eventType,
        actorRole: auditLog.actorRole,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'contact_edited'),
          eq(auditLog.targetEntityId, id),
        ),
      );
    expect(audits.length).toBe(1);
    expect(audits[0].actorRole).toBe('captain');
  });

  it('captain on a different team is rejected with the team-scoped error', async () => {
    const { exec } = await asExec(
      '+919000910001',
      '+919100910001',
    );
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContactWithExec(exec.id, city.id, 'Alice');

    const capB = await seedCaptain({
      phone: '+919000910002',
      fullName: 'Cap B',
    });
    const sess = await loginByPhone(capB.phone, capB.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await editContactAction({
      contactId: id,
      name: 'Hostile edit attempt',
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
    if (!res.ok) expect(res.error).toMatch(/not in your team/i);
  });

  it('captain edit still hits the global phone-collision check', async () => {
    const { cap, exec } = await asExec(
      '+919000920001',
      '+919100920001',
    );
    const city = await getOrCreateCity('Bangalore');
    // Seed two contacts via the exec.
    const a = await seedContactWithExec(exec.id, city.id, 'Alice');
    const b = await seedContactWithExec(exec.id, city.id, 'Bob');

    // Fetch A's stored phone.
    const [aRow] = await db
      .select({ phone: leads.phone })
      .from(leads)
      .where(eq(leads.id, a))
      .limit(1);
    // Strip +91 prefix for the form-side input.
    const aPhone10 = aRow.phone.replace(/^\+91/, '');

    // As captain, try to set B's phone to A's phone.
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await editContactAction({
      contactId: b,
      name: 'Bob',
      firmName: null,
      phone: aPhone10,
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
  });

  it('super_admin can edit any contact', async () => {
    const { exec } = await asExec(
      '+919000930001',
      '+919100930001',
    );
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContactWithExec(exec.id, city.id, 'Alice');

    const sa = await seedSuperAdmin({
      phone: '+918888800163',
      fullName: 'Admin 163',
    });
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await editContactAction({
      contactId: id,
      name: 'Alice (admin-edited)',
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
  });
});

describe('editRequestAction — captain role', () => {
  it('captain whose team includes the assigned exec can edit → ok + audit row with actor_role=captain', async () => {
    const { cap, exec } = await asExec(
      '+919000940001',
      '+919100940001',
    );
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });

    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Captain-edited',
      customerPhone: '9885698665',
      customerEmail: null,
      address: '12 MG Road, Bangalore 560001',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(true);

    const audits = await db
      .select({ actorRole: auditLog.actorRole })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'request_edited'),
          eq(auditLog.targetEntityId, req.id),
        ),
      );
    expect(audits.length).toBe(1);
    expect(audits[0].actorRole).toBe('captain');
  });

  it('captain who IS the assigned captain can edit even if exec is on another team', async () => {
    const capA = await seedCaptain({
      phone: '+919000950001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000950002',
      fullName: 'Cap B',
    });
    const execB = await seedExecutive(capB.id, {
      phone: '+919100950001',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id,
      assignedCaptainUserId: capA.id,
      statusStageCode: 'ASSIGNED',
    });

    const sess = await loginByPhone(capA.phone, capA.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Captain A routed request',
      customerPhone: '9885698665',
      customerEmail: null,
      address: '12 MG Road, Bangalore 560001',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(true);
  });

  it('captain with no team overlap and not the assigned captain is rejected', async () => {
    const { exec } = await asExec(
      '+919000960001',
      '+919100960001',
    );
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });

    const otherCap = await seedCaptain({
      phone: '+919000960002',
      fullName: 'Other Cap',
    });
    const sess = await loginByPhone(otherCap.phone, otherCap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Cross-team attempt',
      customerPhone: '9885698665',
      customerEmail: null,
      address: '12 MG Road, Bangalore 560001',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not in your team/i);
  });

  it('super_admin can edit any request', async () => {
    const { exec } = await asExec(
      '+919000970001',
      '+919100970001',
    );
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });

    const sa = await seedSuperAdmin({
      phone: '+918888800164',
      fullName: 'Admin 164',
    });
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Admin-edited',
      customerPhone: '9885698665',
      customerEmail: null,
      address: '12 MG Road, Bangalore 560001',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(true);
  });
});
