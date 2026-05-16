import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, cities, quotations, visitRequests } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/quotation/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-70: POST /api/requests/[id]/quotation
// =============================================================================
//
// Quotations are MUTABLE per HVA-70 deviation #5. Tests cover:
//   * RBAC (assigned exec / captain-of-city / super_admin allowed;
//     other-exec / other-captain blocked)
//   * Create vs update (server picks by lookup, returns 201 vs 200)
//   * Audit event: quotation_created on first write, quotation_updated
//     on revision (HVA-108 dual-write keeps it in audit_enabled_events)
//   * Validation (zero/negative/too-large rejected; optional fields
//     normalise empty strings → undefined)
//   * Cancelled-request guard (409)
// =============================================================================

function buildReq(body: unknown = {}): Request {
  return new Request('https://visits.beakn.in/api/requests/x/quotation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedScene(cityName = 'Bangalore') {
  const city = await getOrCreateCity(cityName);
  const captain = await seedCaptain();
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id);
  const req = await seedVisitRequest({
    cityId: city.id,
    statusStageCode: 'VISIT_SCHEDULED',
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
  });
  return { city, captain, exec, req };
}

describe('quotation POST: RBAC', () => {
  it('anonymous → 401', async () => {
    currentCookieHeader = undefined;
    const { req } = await seedScene();
    const res = await POST(buildReq({ totalOrderValuePaise: 1000 }), buildCtx(req.id));
    expect(res.status).toBe(401);
  });

  it('assigned exec → 201 create', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 12345600, quotationNumber: 'Q-001' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.quotation.totalOrderValuePaise).toBe(12345600);
    expect(j.quotation.quotationNumber).toBe('Q-001');
  });

  it('captain-of-city → 201 create', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 500000 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(201);
  });

  it('super_admin → 201 create', async () => {
    const admin = await seedSuperAdmin();
    const { req } = await seedScene();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 999900 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(201);
  });

  it('unrelated exec → 403', async () => {
    const { req } = await seedScene();
    const otherCaptain = await seedCaptain({ phone: '+919000022222' });
    const otherExec = await seedExecutive(otherCaptain.id, {
      phone: '+919100022222',
    });
    const sess = await loginByPhone(otherExec.phone, otherExec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 1000 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(403);
  });

  it('captain of different city → 403', async () => {
    const { req } = await seedScene('Bangalore');
    const otherCity = await getOrCreateCity('Pune');
    const otherCaptain = await seedCaptain({ phone: '+919000033333' });
    await db
      .update(cities)
      .set({ captainUserId: otherCaptain.id })
      .where(eq(cities.id, otherCity.id));
    const sess = await loginByPhone(otherCaptain.phone, otherCaptain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 1000 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(403);
  });
});

describe('quotation POST: update path', () => {
  it('second POST on same request → 200 update (mutable)', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const first = await POST(
      buildReq({ totalOrderValuePaise: 100000 }),
      buildCtx(req.id),
    );
    expect(first.status).toBe(201);

    const second = await POST(
      buildReq({ totalOrderValuePaise: 250000, quotationNumber: 'Q-REV' }),
      buildCtx(req.id),
    );
    expect(second.status).toBe(200);
    const j = await second.json();
    expect(j.quotation.totalOrderValuePaise).toBe(250000);
    expect(j.quotation.quotationNumber).toBe('Q-REV');

    // Exactly one row in DB — update, not duplicate insert.
    const rows = await db
      .select()
      .from(quotations)
      .where(eq(quotations.visitRequestId, req.id));
    expect(rows.length).toBe(1);
    expect(Number(rows[0].totalOrderValuePaise)).toBe(250000);
  });

  it('update writes quotation_updated audit event', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    await POST(buildReq({ totalOrderValuePaise: 100000 }), buildCtx(req.id));
    await POST(buildReq({ totalOrderValuePaise: 200000 }), buildCtx(req.id));

    const events = await db
      .select({
        eventType: auditLog.eventType,
        targetEntityId: auditLog.targetEntityId,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    const types = events.map((e) => e.eventType);
    expect(types).toContain('quotation_created');
    expect(types).toContain('quotation_updated');
  });

  it('captain can revise a quote the exec created', async () => {
    const { captain, exec, req } = await seedScene();
    const execSess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = execSess.cookieHeader;
    await POST(buildReq({ totalOrderValuePaise: 100000 }), buildCtx(req.id));

    const capSess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = capSess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 175000 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
  });
});

describe('quotation POST: validation', () => {
  it('zero amount → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 0 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('negative amount → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: -100 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('non-integer paise → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 100.5 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('empty optional strings normalise to null in DB', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({
        totalOrderValuePaise: 100000,
        quotationNumber: '',
        notes: '',
      }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(quotations)
      .where(eq(quotations.visitRequestId, req.id));
    expect(rows[0].quotationNumber).toBeNull();
    expect(rows[0].notes).toBeNull();
  });

  it('missing body → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const bad = new Request('https://x/y', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(bad, buildCtx(req.id));
    expect(res.status).toBe(400);
  });
});

describe('quotation POST: cancelled-request guard', () => {
  it('cancelled request → 409', async () => {
    const { exec, req } = await seedScene();
    await db
      .update(visitRequests)
      .set({ cancelledAt: new Date() })
      .where(eq(visitRequests.id, req.id));
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ totalOrderValuePaise: 100000 }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
  });
});
