import { eq, sql as sqlBuilder } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, rateLimitAttempts, visitRequests } from '@/db/schema';

// Mock the events module BEFORE the route imports it (the route does a
// top-level side-effect import of `@/lib/notifications` which registers
// the captain-new-request email handler; we don't want any real or fake
// sendEmail call inside this file's scope).
const emitSpy = vi.fn();
vi.mock('@/lib/events', () => ({
  emit: (...args: unknown[]) => {
    emitSpy(...args);
  },
  on: () => {},
}));
vi.mock('@/lib/notifications', () => ({}));

// next/headers throws outside a Next.js request scope. Stub it to return
// whatever the current test configured via `currentRequestHeaders`. The
// route uses headers() to extract x-forwarded-for + x-request-id, NOT to
// read cookies for this endpoint.
let currentRequestHeaders = new Headers();
vi.mock('next/headers', () => ({
  headers: async () => currentRequestHeaders,
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/customer-request/route';

// =============================================================================
// HVA-109 Area 1: app/api/customer-request/route.ts
// =============================================================================
//
// Schema reality verified against the live DB + shipped code:
//   - cities.id is FK target for visit_requests.city_id; cities are seeded
//     by migration 0004 (8 real + 'Other').
//   - status_stages.code 'SUBMITTED' is the initial stage (seq 1).
//   - visit_requests.status_stage_id FK (not a string column).
//   - Turnstile is bypassed in tests via TURNSTILE_SECRET_KEY=1x000…AA
//     (Cloudflare always-pass test secret set in tests/setup/global.ts).
//   - Rate limit: RATE_LIMIT_WINDOW=1 hour, RATE_LIMIT_MAX=5 per IP. Both
//     are hard-coded — we trip the ceiling within the test by spamming
//     the same IP, and clean up rate_limit_attempts in afterEach.
//   - Dedup window: 1 hour on customer_phone. Re-submit returns the
//     original tracking_token without inserting a new row.
//   - Phone regex: /^[6-9]\d{9}$/ — 10 digits, first 6-9.
//
// The route's POST handler is a plain Web `Request` → `NextResponse` function;
// we drive it directly with hand-built Request objects (no Next.js HTTP
// server needed).
// =============================================================================

function buildReq(
  body: unknown,
  opts: { ip?: string } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  // Mirror the request headers into the next/headers stub so the route's
  // headersFn() call sees the same x-forwarded-for the test intends.
  currentRequestHeaders = new Headers(headers);
  return new Request('https://visits.beakn.in/api/customer-request', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_PAYLOAD = {
  name: 'Verification Customer',
  phone: '9876500001',
  email: 'cust@example.com',
  address: '42 Verification Lane, Indiranagar',
  city: 'Bangalore',
  state: 'Karnataka',
  bhk: '3 BHK',
  interest: ['Automation'],
  turnstileToken: 'XXXX.DUMMY.PASSES',
};

beforeEach(() => {
  emitSpy.mockReset();
});

afterEach(async () => {
  // afterEach in per-file.ts already truncates everything, but rate_limit_attempts
  // is shared across all tests; an explicit clear keeps these tests independent
  // from any future ordering changes.
  await db.execute(sqlBuilder.raw('TRUNCATE TABLE "rate_limit_attempts" RESTART IDENTITY;'));
});

describe('POST /api/customer-request: happy path', () => {
  it('writes a visit_requests row + audit_log row + emits request.submitted', async () => {
    const res = await POST(buildReq(VALID_PAYLOAD, { ip: '10.0.0.1' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; trackingToken: string };
    expect(body.ok).toBe(true);
    expect(body.trackingToken).toMatch(/^[\w-]{21}$/);

    // visit_requests row landed.
    const [vr] = await db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
        trackingToken: visitRequests.trackingToken,
      })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, body.trackingToken))
      .limit(1);
    expect(vr.customerName).toBe('Verification Customer');
    expect(vr.customerPhone).toBe('+919876500001');

    // audit_log: request_created with anonymous actor (NULL).
    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorUserId: auditLog.actorUserId,
        targetEntityType: auditLog.targetEntityType,
        targetEntityId: auditLog.targetEntityId,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, vr.id));
    expect(audit.length).toBe(1);
    expect(audit[0].eventType).toBe('request_created');
    expect(audit[0].actorUserId).toBeNull();
    expect(audit[0].targetEntityType).toBe('visit_request');

    // emit('request.submitted', payload) fired.
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      'request.submitted',
      expect.objectContaining({
        requestId: vr.id,
        trackingToken: body.trackingToken,
        customerName: 'Verification Customer',
        customerPhone: '+919876500001',
        cityName: 'Bangalore',
      }),
    );
  });

  it("'Other' city is accepted and persisted", async () => {
    const res = await POST(
      buildReq({ ...VALID_PAYLOAD, city: 'Other' }, { ip: '10.0.0.2' }),
    );
    expect(res.status).toBe(200);
    expect(emitSpy).toHaveBeenCalledWith(
      'request.submitted',
      expect.objectContaining({ cityName: 'Other' }),
    );
  });
});

describe('POST /api/customer-request: Zod rejections', () => {
  it('rejects missing name with 400 + fieldErrors', async () => {
    const { name: _name, ...rest } = VALID_PAYLOAD;
    void _name;
    const res = await POST(buildReq(rest));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      fieldErrors?: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.fieldErrors?.name).toBeDefined();
  });

  it('rejects invalid phone format (starts with 5)', async () => {
    const res = await POST(buildReq({ ...VALID_PAYLOAD, phone: '5876500001' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(body.fieldErrors?.phone).toMatch(/Indian mobile/i);
  });

  it('rejects unknown city (HVA-100: name not in cities table)', async () => {
    const res = await POST(buildReq({ ...VALID_PAYLOAD, city: 'Goa' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(body.fieldErrors?.city).toBeDefined();
  });

  it('rejects empty body', async () => {
    const res = await POST(buildReq({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('rejects missing turnstileToken (gates spam)', async () => {
    const { turnstileToken: _t, ...rest } = VALID_PAYLOAD;
    void _t;
    const res = await POST(buildReq(rest));
    expect(res.status).toBe(400);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/customer-request: phone-duplicate dedup window', () => {
  it('same phone within 1hr returns the original trackingToken (no new row)', async () => {
    const first = await POST(buildReq(VALID_PAYLOAD, { ip: '10.0.1.1' }));
    const firstBody = (await first.json()) as { trackingToken: string };

    // Submit again with same phone from a different IP — dedup is by
    // customer_phone, not IP.
    const second = await POST(buildReq(VALID_PAYLOAD, { ip: '10.0.1.2' }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      duplicate?: boolean;
      existingTrackingToken?: string;
      trackingToken?: string;
    };
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.existingTrackingToken).toBe(firstBody.trackingToken);

    // Only one row was inserted.
    const rows = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.customerPhone, '+919876500001'));
    expect(rows.length).toBe(1);
  });

  it('different phone creates a separate row', async () => {
    await POST(buildReq(VALID_PAYLOAD, { ip: '10.0.2.1' }));
    const second = await POST(
      buildReq(
        { ...VALID_PAYLOAD, phone: '9876500099' },
        { ip: '10.0.2.2' },
      ),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { duplicate?: boolean };
    expect(body.duplicate).toBeUndefined();

    const rows = await db
      .select({ phone: visitRequests.customerPhone })
      .from(visitRequests);
    expect(rows.length).toBe(2);
  });
});

describe('POST /api/customer-request: rate limit', () => {
  it('trips 429 after 5 attempts from the same IP within the window', async () => {
    const ip = '10.0.3.1';
    // First 5 succeed (different phones to avoid dedup).
    for (let i = 0; i < 5; i++) {
      const res = await POST(
        buildReq(
          {
            ...VALID_PAYLOAD,
            phone: `987650100${i}`,
            email: `cust${i}@example.com`,
          },
          { ip },
        ),
      );
      expect(res.status).toBe(200);
    }

    // 6th from same IP → 429.
    const blocked = await POST(
      buildReq({ ...VALID_PAYLOAD, phone: '9876501099' }, { ip }),
    );
    expect(blocked.status).toBe(429);
    const blockedBody = (await blocked.json()) as { error: string };
    expect(blockedBody.error).toMatch(/too many requests/i);
  });

  it('does not affect a different IP', async () => {
    const ip = '10.0.4.1';
    // Hammer 5 successful + 1 rate-limited from ip.
    for (let i = 0; i < 5; i++) {
      await POST(buildReq({ ...VALID_PAYLOAD, phone: `987650200${i}` }, { ip }));
    }
    const blockedSameIp = await POST(
      buildReq({ ...VALID_PAYLOAD, phone: '9876502099' }, { ip }),
    );
    expect(blockedSameIp.status).toBe(429);

    // Different IP still passes.
    const otherIp = await POST(
      buildReq(
        { ...VALID_PAYLOAD, phone: '9876502098' },
        { ip: '10.0.4.2' },
      ),
    );
    expect(otherIp.status).toBe(200);
  });
});

// Suppress unused-import lint noise — rateLimitAttempts is referenced by
// the afterEach truncate via the raw SQL helper, not by Drizzle imports.
void rateLimitAttempts;
