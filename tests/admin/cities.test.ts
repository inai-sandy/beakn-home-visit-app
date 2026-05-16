import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, cities } from '@/db/schema';

import { PATCH } from '@/app/api/admin/cities/[id]/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-110: cities config PATCH endpoint — admin-only routing-email edit
// =============================================================================
//
// Drives the PATCH handler directly with a real seeded session. The
// requireSuperAdmin guard reads getServerSession → cookies()/headers()
// from next/headers, which vitest doesn't natively populate. We mock the
// module the same way HVA-101's set-password tests do, threading the
// signed-in session's cookie header through to the action's context.
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

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/admin/cities/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/admin/cities/[id]: RBAC', () => {
  it('rejects anonymous with 401', async () => {
    currentCookieHeader = undefined;
    const city = await getOrCreateCity('Bangalore');
    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'a@b.co' }),
      buildCtx(city.id),
    );
    expect(res.status).toBe(401);
  });

  it('rejects sales_executive with 403', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'a@b.co' }),
      buildCtx(city.id),
    );
    expect(res.status).toBe(403);
  });

  it('rejects captain with 403', async () => {
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');
    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'a@b.co' }),
      buildCtx(city.id),
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/cities/[id]: happy path', () => {
  it('updates captain_routing_email with a valid RFC email + writes audit', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Hyderabad');

    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'captain.hyd@example.com' }),
      buildCtx(city.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      city: { captainRoutingEmail: string | null };
      changed: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(true);
    expect(body.city.captainRoutingEmail).toBe('captain.hyd@example.com');

    // DB-side mutation.
    const [updated] = await db
      .select({ captainRoutingEmail: cities.captainRoutingEmail })
      .from(cities)
      .where(eq(cities.id, city.id))
      .limit(1);
    expect(updated.captainRoutingEmail).toBe('captain.hyd@example.com');

    // Audit row written with before/after.
    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorRole: auditLog.actorRole,
        targetEntityType: auditLog.targetEntityType,
        targetEntityId: auditLog.targetEntityId,
        beforeState: auditLog.beforeState,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, city.id));
    expect(audit.length).toBe(1);
    expect(audit[0].eventType).toBe('city_routing_email_updated');
    expect(audit[0].actorRole).toBe('super_admin');
    expect(audit[0].targetEntityType).toBe('city');
    expect(audit[0].beforeState).toMatchObject({
      name: 'Hyderabad',
      captainRoutingEmail: null,
    });
    expect(audit[0].afterState).toMatchObject({
      name: 'Hyderabad',
      captainRoutingEmail: 'captain.hyd@example.com',
    });
  });

  it('blank value resets captain_routing_email to NULL (UNROUTED fallback)', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Pune');

    // Set first
    await PATCH(
      buildReq({ captainRoutingEmail: 'captain.pune@example.com' }),
      buildCtx(city.id),
    );
    // Then blank
    const res = await PATCH(buildReq({ captainRoutingEmail: '' }), buildCtx(city.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      city: { captainRoutingEmail: string | null };
    };
    expect(body.city.captainRoutingEmail).toBeNull();

    const [updated] = await db
      .select({ captainRoutingEmail: cities.captainRoutingEmail })
      .from(cities)
      .where(eq(cities.id, city.id))
      .limit(1);
    expect(updated.captainRoutingEmail).toBeNull();
  });

  it('explicit null also resets to NULL', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Vizag');
    await PATCH(
      buildReq({ captainRoutingEmail: 'captain.vizag@example.com' }),
      buildCtx(city.id),
    );
    const res = await PATCH(
      buildReq({ captainRoutingEmail: null }),
      buildCtx(city.id),
    );
    expect(res.status).toBe(200);
    const [updated] = await db
      .select({ captainRoutingEmail: cities.captainRoutingEmail })
      .from(cities)
      .where(eq(cities.id, city.id))
      .limit(1);
    expect(updated.captainRoutingEmail).toBeNull();
  });

  it('no-op write (same value) returns ok with changed=false, no audit row', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Chennai');
    await PATCH(
      buildReq({ captainRoutingEmail: 'captain.chn@example.com' }),
      buildCtx(city.id),
    );

    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'captain.chn@example.com' }),
      buildCtx(city.id),
    );
    const body = (await res.json()) as { ok: boolean; changed: boolean };
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(false);

    // Audit log has exactly one row (the first write), not two.
    const audit = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, city.id));
    expect(audit.length).toBe(1);
  });
});

describe('PATCH /api/admin/cities/[id]: validation', () => {
  it('rejects malformed email with 400 + fieldErrors', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Mumbai');

    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'not-an-email' }),
      buildCtx(city.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      fieldErrors?: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.fieldErrors?.captainRoutingEmail).toMatch(/valid email/i);

    // DB unchanged.
    const [unchanged] = await db
      .select({ captainRoutingEmail: cities.captainRoutingEmail })
      .from(cities)
      .where(eq(cities.id, city.id))
      .limit(1);
    expect(unchanged.captainRoutingEmail).toBeNull();
  });

  it('rejects PATCH on the Other row with 400 + clear error', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const other = await getOrCreateCity('Other');

    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'shouldnotwork@example.com' }),
      buildCtx(other.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      fieldErrors?: Record<string, string>;
    };
    expect(body.error).toMatch(/Other.*super_admins/i);
    expect(body.fieldErrors?.captainRoutingEmail).toMatch(/super_admins/i);

    // DB-side: Other row stays NULL.
    const [unchanged] = await db
      .select({ captainRoutingEmail: cities.captainRoutingEmail })
      .from(cities)
      .where(eq(cities.id, other.id))
      .limit(1);
    expect(unchanged.captainRoutingEmail).toBeNull();
  });

  it('rejects unknown city UUID with 404', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'a@b.co' }),
      buildCtx('00000000-0000-7000-8000-000000000000'),
    );
    expect(res.status).toBe(404);
  });

  it('rejects bad UUID shape with 400', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await PATCH(
      buildReq({ captainRoutingEmail: 'a@b.co' }),
      buildCtx('not-a-uuid'),
    );
    expect(res.status).toBe(400);
  });
});
