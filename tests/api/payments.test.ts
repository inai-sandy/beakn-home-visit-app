import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, cities, payments, quotations, visitRequests } from '@/db/schema';
import { computeCollectionSummary } from '@/lib/collection-summary';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/payments/route';
import { POST as voidPOST } from '@/app/api/requests/[id]/payments/[paymentId]/void/route';
import { POST as quotationPOST } from '@/app/api/requests/[id]/quotation/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-70: POST /api/requests/[id]/payments + /void
// =============================================================================
//
// RBAC matrix:
//   inbound:  exec(assigned) | captain(of city) | admin → allowed
//   outbound: captain(of city) | admin → allowed     (exec → 403)
//   void:     captain(of city) | admin → allowed     (exec → 403)
//
// Tests also cover:
//   * Audit dispatch (payment_recorded vs refund_recorded vs payment_voided)
//   * Validation (zero, missing fields, bad date, refund-label-too-short)
//   * Idempotency (re-void → 409)
//   * Cross-city captain blocked
//   * Cancelled-request guard
// =============================================================================

function buildReq(body: unknown = {}): Request {
  return new Request('https://visits.beakn.in/api/requests/x/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function buildVoidCtx(id: string, paymentId: string) {
  return { params: Promise.resolve({ id, paymentId }) };
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

const inboundBody = (overrides: Record<string, unknown> = {}) => ({
  direction: 'inbound',
  amountPaise: 25000_00,
  paymentDate: '2026-05-10',
  mode: 'UPI',
  ...overrides,
});

const outboundBody = (overrides: Record<string, unknown> = {}) => ({
  direction: 'outbound',
  amountPaise: 5000_00,
  paymentDate: '2026-05-12',
  mode: 'Bank Transfer',
  label: 'Customer cancelled partial',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Inbound RBAC
// ---------------------------------------------------------------------------

describe('payments POST inbound: RBAC', () => {
  it('anonymous → 401', async () => {
    currentCookieHeader = undefined;
    const { req } = await seedScene();
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
    expect(res.status).toBe(401);
  });

  it('assigned exec inbound → 201', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.payment.direction).toBe('inbound');
    expect(j.payment.amountPaise).toBe(2500000);
  });

  it('captain-of-city inbound → 201', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
    expect(res.status).toBe(201);
  });

  it('super_admin inbound → 201', async () => {
    const admin = await seedSuperAdmin();
    const { req } = await seedScene();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
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
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
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
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Outbound RBAC — the deviation #4 gate
// ---------------------------------------------------------------------------

describe('payments POST outbound: RBAC (HVA-70 deviation #4)', () => {
  it('assigned exec outbound → 403 (refund is captain/admin only)', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(outboundBody()), buildCtx(req.id));
    expect(res.status).toBe(403);
  });

  it('captain-of-city outbound → 201', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(outboundBody()), buildCtx(req.id));
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j.payment.direction).toBe('outbound');
    expect(j.payment.label).toBe('Customer cancelled partial');
  });

  it('super_admin outbound → 201', async () => {
    const admin = await seedSuperAdmin();
    const { req } = await seedScene();
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(outboundBody()), buildCtx(req.id));
    expect(res.status).toBe(201);
  });

  it('captain of different city outbound → 403', async () => {
    const { req } = await seedScene('Bangalore');
    const otherCity = await getOrCreateCity('Pune');
    const otherCaptain = await seedCaptain({ phone: '+919000033333' });
    await db
      .update(cities)
      .set({ captainUserId: otherCaptain.id })
      .where(eq(cities.id, otherCity.id));
    const sess = await loginByPhone(otherCaptain.phone, otherCaptain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(outboundBody()), buildCtx(req.id));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('payments POST: validation', () => {
  it('zero amount → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq(inboundBody({ amountPaise: 0 })),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('bad date → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq(inboundBody({ paymentDate: 'not-a-date' })),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('unknown mode → 400', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq(inboundBody({ mode: 'Bitcoin' })),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('refund without label → 400', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq(outboundBody({ label: undefined })),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('refund with short label → 400', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq(outboundBody({ label: 'no' })),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('inbound with no label is fine', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq(inboundBody({ label: undefined })),
      buildCtx(req.id),
    );
    expect(res.status).toBe(201);
  });

  it('Card / Other modes accepted (HVA-70 enum extension)', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const r1 = await POST(
      buildReq(inboundBody({ mode: 'Card' })),
      buildCtx(req.id),
    );
    expect(r1.status).toBe(201);
    const r2 = await POST(
      buildReq(inboundBody({ mode: 'Other' })),
      buildCtx(req.id),
    );
    expect(r2.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Audit dispatch
// ---------------------------------------------------------------------------

describe('payments POST: audit dispatch', () => {
  it('inbound writes payment_recorded', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
    expect(res.status).toBe(201);
    const events = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    expect(events.map((e) => e.eventType)).toContain('payment_recorded');
  });

  it('outbound writes refund_recorded', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(outboundBody()), buildCtx(req.id));
    expect(res.status).toBe(201);
    const events = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    expect(events.map((e) => e.eventType)).toContain('refund_recorded');
  });
});

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

describe('payments void POST', () => {
  it('captain-of-city → 200 + voided columns set + audit event', async () => {
    const { captain, exec, req } = await seedScene();
    // Seed with the assigned exec so we can be sure the void path doesn't
    // accidentally infer authorization from the recording exec.
    const execSess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = execSess.cookieHeader;
    const create = await POST(buildReq(inboundBody()), buildCtx(req.id));
    const createJson = await create.json();
    const paymentId: string = createJson.payment.id;

    const capSess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = capSess.cookieHeader;
    const res = await voidPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Duplicate UPI entry by mistake' }),
      }),
      buildVoidCtx(req.id, paymentId),
    );
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId));
    expect(row.voidedAt).not.toBeNull();
    expect(row.voidedByUserId).toBe(captain.id);
    expect(row.voidedReason).toBe('Duplicate UPI entry by mistake');

    const events = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    expect(events.map((e) => e.eventType)).toContain('payment_voided');
  });

  it('assigned exec → 403 (HVA-70 deviation: exec cannot void)', async () => {
    const { exec, captain, req } = await seedScene();
    const capSess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = capSess.cookieHeader;
    const create = await POST(buildReq(inboundBody()), buildCtx(req.id));
    const paymentId: string = (await create.json()).payment.id;

    const execSess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = execSess.cookieHeader;
    const res = await voidPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'I want to fix this myself' }),
      }),
      buildVoidCtx(req.id, paymentId),
    );
    expect(res.status).toBe(403);
  });

  it('reason too short → 400', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const create = await POST(buildReq(inboundBody()), buildCtx(req.id));
    const paymentId: string = (await create.json()).payment.id;
    const res = await voidPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'oops' }),
      }),
      buildVoidCtx(req.id, paymentId),
    );
    expect(res.status).toBe(400);
  });

  it('re-voiding an already-voided payment → 409', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const create = await POST(buildReq(inboundBody()), buildCtx(req.id));
    const paymentId: string = (await create.json()).payment.id;

    const first = await voidPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'First void reason - legitimate' }),
      }),
      buildVoidCtx(req.id, paymentId),
    );
    expect(first.status).toBe(200);

    const second = await voidPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Second void attempt should fail' }),
      }),
      buildVoidCtx(req.id, paymentId),
    );
    expect(second.status).toBe(409);
  });

  it('void non-existent payment → 404', async () => {
    const { captain, req } = await seedScene();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await voidPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Non-existent payment void test' }),
      }),
      buildVoidCtx(req.id, '00000000-0000-7000-8000-000000000000'),
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Cancelled guard
// ---------------------------------------------------------------------------

describe('payments POST: cancelled guard', () => {
  it('cancelled request → 409 (no new payments)', async () => {
    const { exec, req } = await seedScene();
    await db
      .update(visitRequests)
      .set({ cancelledAt: new Date() })
      .where(eq(visitRequests.id, req.id));
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(inboundBody()), buildCtx(req.id));
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Summary computation — overpayment surfacing (AC #9 follow-up)
// ---------------------------------------------------------------------------
//
// The Collection section's summary block is server-rendered, but the
// math lives in lib/collection-summary.ts so we can assert it directly.
// HVA-101 doesn't render React, so there is no UI snapshot — the value
// of THIS test is to lock the math behind the new "Overpaid" label.
//
// Scenario: quotation ₹800 (80000 paise) + one inbound ₹1,000 (100000
// paise) → balancePaise = -20000, isOverpaid = true, overpaidPaise =
// 20000.

describe('payments summary computation: overpayment (AC #9)', () => {
  it('quotation ₹800 paid ₹1,000 → balance -20000 paise, isOverpaid true', async () => {
    const { exec, req } = await seedScene();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const qres = await quotationPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ totalOrderValuePaise: 80000 }),
      }),
      buildCtx(req.id),
    );
    expect(qres.status).toBe(201);

    const pres = await POST(
      buildReq(inboundBody({ amountPaise: 100000 })),
      buildCtx(req.id),
    );
    expect(pres.status).toBe(201);

    const [q] = await db
      .select({ paise: quotations.totalOrderValuePaise })
      .from(quotations)
      .where(eq(quotations.visitRequestId, req.id));
    const ps = await db
      .select({
        direction: payments.direction,
        amountPaise: payments.amountPaise,
        voidedAt: payments.voidedAt,
      })
      .from(payments)
      .where(eq(payments.visitRequestId, req.id));

    const summary = computeCollectionSummary(
      Number(q.paise),
      ps.map((p) => ({
        direction: p.direction,
        amountPaise: Number(p.amountPaise),
        voidedAt: p.voidedAt,
      })),
    );

    expect(summary.quotedPaise).toBe(80000);
    expect(summary.inboundPaise).toBe(100000);
    expect(summary.outboundPaise).toBe(0);
    expect(summary.netReceivedPaise).toBe(100000);
    expect(summary.balancePaise).toBe(-20000);
    expect(summary.overpaidPaise).toBe(20000);
    expect(summary.isOverpaid).toBe(true);
    expect(summary.isFullyCollected).toBe(false);
  });

  it('refunding the overpayment returns to balance 0 (isFullyCollected true)', async () => {
    const { captain, req } = await seedScene();
    const capSess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = capSess.cookieHeader;

    await quotationPOST(
      new Request('https://x/y', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ totalOrderValuePaise: 80000 }),
      }),
      buildCtx(req.id),
    );
    await POST(buildReq(inboundBody({ amountPaise: 100000 })), buildCtx(req.id));
    await POST(
      buildReq(outboundBody({ amountPaise: 20000, label: 'Refund overpaid' })),
      buildCtx(req.id),
    );

    const [q] = await db
      .select({ paise: quotations.totalOrderValuePaise })
      .from(quotations)
      .where(eq(quotations.visitRequestId, req.id));
    const ps = await db
      .select({
        direction: payments.direction,
        amountPaise: payments.amountPaise,
        voidedAt: payments.voidedAt,
      })
      .from(payments)
      .where(eq(payments.visitRequestId, req.id));

    const summary = computeCollectionSummary(
      Number(q.paise),
      ps.map((p) => ({
        direction: p.direction,
        amountPaise: Number(p.amountPaise),
        voidedAt: p.voidedAt,
      })),
    );

    expect(summary.balancePaise).toBe(0);
    expect(summary.isOverpaid).toBe(false);
    expect(summary.isFullyCollected).toBe(true);
    expect(summary.overpaidPaise).toBe(0);
  });
});
