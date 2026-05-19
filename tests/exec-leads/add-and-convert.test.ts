import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addLeadAction } from '@/app/(exec)/leads/_actions/addLead';
import { convertLeadToRequestAction } from '@/app/(exec)/leads/_actions/convertLead';
import { db } from '@/db/client';
import {
  auditLog,
  businessTypes,
  cities,
  leads,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-73 + HVA-74: leads section + conversion action tests
// =============================================================================
//
// Server-action tests. Both actions read getServerSession via
// next/headers — mock the same way tests/admin/cities.test.ts does so the
// signed-in cookie is threaded through to auth-server.
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

async function seedBusinessType(code: string, name: string, seq = 1) {
  const [row] = await db
    .insert(businessTypes)
    .values({ code, name, sequenceNumber: seq, isActive: true })
    .returning({ id: businessTypes.id });
  return row.id;
}

const VALID_CITY_UUID = '00000000-0000-7000-8000-000000000999';
const VALID_BT_UUID = '00000000-0000-7000-8000-000000000888';

beforeEach(() => {
  currentCookieHeader = undefined;
});

describe('HVA-73 addLeadAction — auth', () => {
  it('refuses anonymous callers', async () => {
    currentCookieHeader = undefined;
    const city = await getOrCreateCity('Bangalore');
    const res = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign/i);
  });

  it('refuses callers without exec/admin role (e.g. captain)', async () => {
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const res = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/forbidden/i);
  });
});

describe('HVA-73 addLeadAction — validation', () => {
  it('returns field errors for missing/invalid inputs', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await addLeadAction({
      type: 'Customer',
      name: 'A', // too short
      phone: '123', // not a 10-digit mobile
      cityId: 'not-a-uuid',
      interest: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fieldErrors).toBeDefined();
      expect(Object.keys(res.fieldErrors!).length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown cityId at the FK check', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: VALID_CITY_UUID, // valid UUID shape, no row
      interest: ['Automation'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.cityId).toBeTruthy();
  });

  it('rejects an unknown businessTypeId for Business leads', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const res = await addLeadAction({
      type: 'Business',
      name: 'Studio Architects',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      firmName: 'Studio Architects',
      businessTypeId: VALID_BT_UUID, // valid UUID shape, no row
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.businessTypeId).toBeTruthy();
  });
});

describe('HVA-73 addLeadAction — happy paths', () => {
  it('inserts a Customer lead and stores phone with +91 prefix', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const res = await addLeadAction({
      type: 'Customer',
      name: 'Alice Roy',
      phone: '9885698665',
      email: 'alice@example.com',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
      notes: 'Met at expo',
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const leadId = res.data!.leadId;

    const [row] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    expect(row.type).toBe('Customer');
    expect(row.phone).toBe('+919885698665');
    expect(row.email).toBe('alice@example.com');
    expect(row.bhk).toBe('3BHK');
    expect(row.firmName).toBeNull();
    expect(row.businessTypeId).toBeNull();
    expect(row.capturedByUserId).toBe(exec.id);
    expect(row.convertedToRequestId).toBeNull();
    expect(row.convertedAt).toBeNull();
  });

  it('inserts a Business lead with firmName + businessTypeId', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const btId = await seedBusinessType('interior_designer', 'Interior Designer');

    const res = await addLeadAction({
      type: 'Business',
      name: 'Priya at Studio Architects',
      phone: '9123456780',
      cityId: city.id,
      interest: ['Automation'],
      firmName: 'Studio Architects',
      businessTypeId: btId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, res.data!.leadId))
      .limit(1);
    expect(row.type).toBe('Business');
    expect(row.firmName).toBe('Studio Architects');
    expect(row.businessTypeId).toBe(btId);
    expect(row.bhk).toBeNull();
  });
});

describe('HVA-74 convertLeadToRequestAction — auth + ownership', () => {
  it('refuses anonymous callers', async () => {
    currentCookieHeader = undefined;
    const res = await convertLeadToRequestAction({
      leadId: '00000000-0000-7000-8000-000000000000',
      extra: {
        address: 'Some address line, Bangalore',
        bhk: '3BHK',
      },
    });
    expect(res.ok).toBe(false);
  });

  it('refuses a different exec converting another exec\'s lead', async () => {
    const cap = await seedCaptain();
    const execA = await seedExecutive(cap.id, {
      phone: '+919100000001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100000002',
      fullName: 'Exec B',
    });
    const sessA = await loginByPhone(execA.phone, execA.password);
    currentCookieHeader = sessA.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const addRes = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addRes.ok).toBe(true);
    if (!addRes.ok) return;

    // Switch to exec B
    const sessB = await loginByPhone(execB.phone, execB.password);
    currentCookieHeader = sessB.cookieHeader;

    const res = await convertLeadToRequestAction({
      leadId: addRes.data!.leadId,
      extra: {
        address: '12 MG Road, Bangalore',
        bhk: '3BHK',
      },
    });
    expect(res.ok).toBe(false);
    // HVA-73 PR 3: the ownership error message moved from "your own"
    // to "not visible to you" when visibility broadened. Exec B has no
    // assignment trail to this lead's contact, so they remain blocked.
    if (!res.ok) expect(res.error).toMatch(/not visible to you/i);
  });
});

describe('HVA-74 convertLeadToRequestAction — happy path', () => {
  it('creates an ASSIGNED visit_request, marks the lead converted, and writes history + audit', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    // Wire the city to the captain so we can assert mirroring of
    // assigned_captain_user_id on the resulting visit_request.
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.id, city.id));

    const addRes = await addLeadAction({
      type: 'Customer',
      name: 'Alice Roy',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addRes.ok).toBe(true);
    if (!addRes.ok) return;
    const leadId = addRes.data!.leadId;

    const conv = await convertLeadToRequestAction({
      leadId,
      extra: {
        address: '12 MG Road, Bangalore 560001',
        bhk: '3BHK',
      },
    });
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;
    const reqId = conv.data!.requestId;

    const assigned = await getStatusStage('ASSIGNED');

    const [req] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, reqId))
      .limit(1);
    expect(req.assignedExecUserId).toBe(exec.id);
    expect(req.assignedCaptainUserId).toBe(cap.id);
    expect(req.statusStageId).toBe(assigned.id);
    expect(req.source).toBe('lead_conversion');
    expect(req.customerPhone).toBe('+919885698665');
    expect(req.address).toBe('12 MG Road, Bangalore 560001');
    expect(req.bhk).toBe('3BHK');
    // HVA-73 PR 1: every conversion sets contact_id back to the source lead.
    expect(req.contactId).toBe(leadId);

    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    expect(lead.convertedToRequestId).toBe(reqId);
    expect(lead.convertedAt).not.toBeNull();

    const history = await db
      .select()
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, reqId));
    expect(history).toHaveLength(1);
    expect(history[0].fromStatusStageId).toBeNull();
    expect(history[0].toStatusStageId).toBe(assigned.id);
    expect(history[0].transitionOrder).toBe(1);

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'lead_converted_to_request'),
          eq(auditLog.targetEntityId, leadId),
        ),
      );
    expect(audit.length).toBeGreaterThan(0);
  });

  it('PR 1: allows re-conversion — each call creates a NEW request, both reference the contact via contact_id', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const addRes = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addRes.ok).toBe(true);
    if (!addRes.ok) return;
    const leadId = addRes.data!.leadId;

    const first = await convertLeadToRequestAction({
      leadId,
      extra: { address: '12 MG Road, Bangalore', bhk: '3BHK' },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await convertLeadToRequestAction({
      leadId,
      extra: { address: '34 Indiranagar, Bangalore', bhk: '2BHK' },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data!.requestId).not.toBe(first.data!.requestId);

    // Both requests reference the same contact.
    const reqs = await db
      .select({ id: visitRequests.id, contactId: visitRequests.contactId })
      .from(visitRequests)
      .where(eq(visitRequests.contactId, leadId));
    expect(reqs).toHaveLength(2);
    for (const r of reqs) expect(r.contactId).toBe(leadId);

    // The lead's legacy convertedToRequestId points at the FIRST request only.
    const [lead] = await db
      .select({
        convertedToRequestId: leads.convertedToRequestId,
        convertedAt: leads.convertedAt,
      })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    expect(lead.convertedToRequestId).toBe(first.data!.requestId);
    expect(lead.convertedAt).not.toBeNull();
  });

  it('rejects conversion when address is too short', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const addRes = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addRes.ok).toBe(true);
    if (!addRes.ok) return;

    const res = await convertLeadToRequestAction({
      leadId: addRes.data!.leadId,
      extra: { address: 'short', bhk: '3BHK' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.address).toBeTruthy();
  });
});

describe('HVA-74 convertLeadToRequestAction — super_admin override', () => {
  it('lets a super_admin convert someone else\'s lead', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const addRes = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addRes.ok).toBe(true);
    if (!addRes.ok) return;

    const sa = await seedSuperAdmin();
    const saSess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = saSess.cookieHeader;

    const res = await convertLeadToRequestAction({
      leadId: addRes.data!.leadId,
      extra: { address: '12 MG Road, Bangalore', bhk: '3BHK' },
    });
    expect(res.ok).toBe(true);
  });
});
