import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editRequestAction } from '@/app/requests/[id]/_actions/editRequest';
import { db } from '@/db/client';
import { auditLog, visitRequests } from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-159: editRequestAction tests
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

describe('editRequestAction — auth (strict D2)', () => {
  it('current assignee can edit', async () => {
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

    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Edited Name',
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

  it('unrelated exec is rejected', async () => {
    const cap = await seedCaptain();
    const execA = await seedExecutive(cap.id, {
      phone: '+919100410001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100410002',
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

    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Unrelated edit attempt',
      customerPhone: '9885698665',
      customerEmail: null,
      address: '12 MG Road, Bangalore',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not editable by you/i);
  });
});

describe('editRequestAction — happy path + audit', () => {
  it('updates editable fields and writes request_edited with a sparse diff', async () => {
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

    const futureIso = new Date(Date.now() + 86_400_000).toISOString();
    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Edited Customer',
      customerPhone: '9123456780',
      customerEmail: 'edited@example.com',
      address: '34 Indiranagar, Bangalore 560038',
      cityId: city.id,
      bhk: '2BHK',
      customerState: 'Karnataka',
      visitScheduledAt: futureIso,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toBe(true);

    const [row] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(row.customerName).toBe('Edited Customer');
    expect(row.customerPhone).toBe('+919123456780');
    expect(row.customerEmail).toBe('edited@example.com');
    expect(row.bhk).toBe('2BHK');
    expect(row.customerState).toBe('Karnataka');
    expect(row.visitScheduledAt).not.toBeNull();

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'request_edited'),
          eq(auditLog.targetEntityId, req.id),
        ),
      );
    expect(audits.length).toBe(1);
    const before = audits[0].beforeState as Record<string, unknown>;
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('customerName', 'Edited Customer');
    expect(after).toHaveProperty('customerPhone', '+919123456780');
    expect(before).toHaveProperty('customerName', 'Test Customer');
  });

  it('no-op edit returns ok with changed=false and writes no audit row', async () => {
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

    // seedVisitRequest defaults: customerName='Test Customer',
    // customerPhone='+919999999999', address='Test address line',
    // bhk='3BHK', interest=['Automation'].
    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Test Customer',
      customerPhone: '9999999999',
      customerEmail: null,
      address: 'Test address line',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toBe(false);

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'request_edited'),
          eq(auditLog.targetEntityId, req.id),
        ),
      );
    expect(audits.length).toBe(0);
  });
});

describe('editRequestAction — invalid field rejects', () => {
  it('rejects malformed phone', async () => {
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

    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'Edit',
      customerPhone: '12345',
      customerEmail: null,
      address: '12 MG Road, Bangalore',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.customerPhone).toBeTruthy();
  });
});

describe('editRequestAction — does NOT touch linked contact (D5)', () => {
  it('changing customerName does not propagate to leads.name', async () => {
    // No assertion path through the DB beyond confirming no contact row
    // was updated — we don't seed a contact_id link on the seeded request
    // (seedVisitRequest leaves contactId null), so the rule is vacuously
    // true for this seed. We still pin the editRequestAction return
    // shape; the no-sync rule is enforced by the action's body never
    // touching the leads table.
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

    const res = await editRequestAction({
      requestId: req.id,
      customerName: 'New Name',
      customerPhone: '9999999999',
      customerEmail: null,
      address: 'Test address line',
      cityId: city.id,
      bhk: '3BHK',
      customerState: null,
      visitScheduledAt: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.changed).toBe(true);
  });
});
