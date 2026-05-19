import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, cities, leads, visitRequests } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/assign/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-73 PR 2: captain assignment runs the find-or-create-contact step
// =============================================================================
//
// Each test runs through POST /api/requests/[id]/assign and then inspects
// the leads + visit_requests + audit_log rows. Pattern mirrors
// tests/api/captain-assign.test.ts.
// =============================================================================

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/requests/x/assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function setupCaptainOwningCityWithExec(name = 'Bangalore') {
  const city = await getOrCreateCity(name);
  const captain = await seedCaptain();
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id);
  return { city, captain, exec };
}

async function loadVisitRequest(id: string) {
  const [row] = await db
    .select({
      assignedExecUserId: visitRequests.assignedExecUserId,
      contactId: visitRequests.contactId,
      customerPhone: visitRequests.customerPhone,
    })
    .from(visitRequests)
    .where(eq(visitRequests.id, id))
    .limit(1);
  return row;
}

describe('captain assign — auto-create contact (NEW phone)', () => {
  it('creates a leads row owned by the freshly-assigned exec, links visit_requests.contact_id, and writes request_contact_linked audit', async () => {
    const { city, captain, exec } = await setupCaptainOwningCityWithExec();
    const req = await seedVisitRequest({ cityId: city.id });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(200);

    const vr = await loadVisitRequest(req.id);
    expect(vr.contactId).toBeTruthy();

    // The lead exists, phone in storage form, captor = assigned exec.
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, vr.contactId!))
      .limit(1);
    expect(lead.type).toBe('Customer');
    expect(lead.phone).toBe(vr.customerPhone);
    expect(lead.capturedByUserId).toBe(exec.id);
    expect(lead.cityId).toBe(city.id);

    const audits = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetEntityId, req.id),
          eq(auditLog.eventType, 'request_contact_linked'),
        ),
      );
    expect(audits.length).toBe(1);
  });
});

describe('captain assign — link to EXISTING contact (matched by phone)', () => {
  it('reuses the existing lead and does NOT insert a second leads row', async () => {
    const { city, captain, exec } = await setupCaptainOwningCityWithExec();
    // Pre-seed a lead with the phone the seeded request will carry.
    const seededPhone = '+919999999999'; // matches seedVisitRequest default.
    const [existingLead] = await db
      .insert(leads)
      .values({
        type: 'Customer',
        name: 'Pre-existing Customer',
        phone: seededPhone,
        cityId: city.id,
        interest: [],
        capturedByUserId: exec.id,
      })
      .returning({ id: leads.id });

    const req = await seedVisitRequest({ cityId: city.id });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(200);

    const vr = await loadVisitRequest(req.id);
    expect(vr.contactId).toBe(existingLead.id);

    // No second lead row exists for that phone.
    const allWithPhone = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.phone, seededPhone));
    expect(allWithPhone.length).toBe(1);
  });
});

describe('captain assign — pre-existing contact_id is NOT overwritten', () => {
  it('skips find-or-create when visit_requests.contact_id is already set', async () => {
    const { city, captain, exec } = await setupCaptainOwningCityWithExec();

    // Seed a lead and a request that already references it (simulates the
    // HVA-74 lead-conversion path, which writes contact_id at insert time
    // but stages at ASSIGNED — we override stage to SUBMITTED here to
    // make the route accept the assignment for this defensive test).
    const [seededLead] = await db
      .insert(leads)
      .values({
        type: 'Customer',
        name: 'Lead-conversion seed',
        phone: '+919999999999',
        cityId: city.id,
        interest: [],
        capturedByUserId: exec.id,
      })
      .returning({ id: leads.id });

    const req = await seedVisitRequest({ cityId: city.id });
    await db
      .update(visitRequests)
      .set({ contactId: seededLead.id })
      .where(eq(visitRequests.id, req.id));

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({ execUserId: exec.id }), buildCtx(req.id));
    expect(res.status).toBe(200);

    const vr = await loadVisitRequest(req.id);
    expect(vr.contactId).toBe(seededLead.id);

    // No 'request_contact_linked' audit row, since we short-circuited.
    const audits = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetEntityId, req.id),
          eq(auditLog.eventType, 'request_contact_linked'),
        ),
      );
    expect(audits.length).toBe(0);
  });
});
