import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { proxy } from '@/proxy';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-101 / Area 1: proxy.ts precedence + role gates + super_admin escape hatch
// =============================================================================
//
// Strategy: call proxy() directly with a hand-built NextRequest. The proxy
// reads auth.api.getSession(headers) — so we sign in via Better-Auth's
// programmatic API and attach the resulting Cookie header to the request.
// No HTTP server needed.
//
// What each block exercises:
//   - Public/anonymous gating (step 1+2 of proxy.ts)
//   - mustChangePassword pin (step 3) — wins over role routing
//   - Role-based access (step 4) — captain ↔ exec ↔ super_admin
//   - super_admin escape hatch in canAccess() — has access to every
//     role-prefixed area, including /dev/* when DEV_ROUTES_ENABLED is on
// =============================================================================

const BASE_URL = 'https://visits.beakn.in';

function buildReq(
  pathname: string,
  init: { cookie?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(`${BASE_URL}${pathname}`, { headers });
}

const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_DEV_ROUTES = process.env.DEV_ROUTES_ENABLED;

describe('proxy: anonymous gating', () => {
  it('public page /login → pass-through (200-style)', async () => {
    const res = await proxy(buildReq('/login'));
    // NextResponse.next() returns 200 with no Location.
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('anonymous on /captain/dashboard → 307 to /login?next=…', async () => {
    const res = await proxy(buildReq('/captain/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fcaptain%2Fdashboard');
  });

  it('anonymous on /admin/captains → 307 to /login?next=…', async () => {
    const res = await proxy(buildReq('/admin/captains'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fadmin%2Fcaptains');
  });

  it('anonymous on /today → 307 to /login?next=…', async () => {
    const res = await proxy(buildReq('/today'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Ftoday');
  });
});

describe('proxy: role-based routing', () => {
  it('captain on /captain/dashboard → allowed (200-style pass-through)', async () => {
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    const res = await proxy(buildReq('/captain/dashboard', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('captain on /admin/captains → 307 to /captain/dashboard?denied=1', async () => {
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    const res = await proxy(buildReq('/admin/captains', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/captain/dashboard?denied=1');
  });

  it('sales_executive on /today → allowed', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    const res = await proxy(buildReq('/today', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
  });

  it('sales_executive on /captain/dashboard → 307 to /today?denied=1', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    const res = await proxy(buildReq('/captain/dashboard', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/today?denied=1');
  });
});

describe('proxy: super_admin escape hatch (canAccess)', () => {
  it('super_admin can reach /captain/dashboard', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    const res = await proxy(buildReq('/captain/dashboard', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
  });

  it('super_admin can reach /today (sales_executive area)', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    const res = await proxy(buildReq('/today', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
  });

  it('super_admin can reach /admin/captains', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    const res = await proxy(buildReq('/admin/captains', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
  });
});

describe('proxy: mustChangePassword pin (step 3 takes precedence over role routing)', () => {
  it('authenticated + mustChange=true → /set-password regardless of role-target', async () => {
    const cap = await seedCaptain({ mustChangePassword: true });
    const sess = await loginByPhone(cap.phone, cap.password);
    // Captain hitting their own home — without the pin they'd be allowed
    // (200). With the pin they bounce to /set-password.
    const res = await proxy(buildReq('/captain/dashboard', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/set-password');
  });

  it('mustChange=true visiting /login → 307 to /set-password (not role home)', async () => {
    const cap = await seedCaptain({ mustChangePassword: true });
    const sess = await loginByPhone(cap.phone, cap.password);
    const res = await proxy(buildReq('/login', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/set-password');
  });

  it('mustChange=true on /set-password itself → pass-through (no redirect loop)', async () => {
    const cap = await seedCaptain({ mustChangePassword: true });
    const sess = await loginByPhone(cap.phone, cap.password);
    const res = await proxy(buildReq('/set-password', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
  });
});

describe('proxy: /dev/* env-gate (HVA-99 + HVA-40 escape hatch)', () => {
  beforeEach(() => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
  });
  afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = ORIG_NODE_ENV ?? 'test';
    if (ORIG_DEV_ROUTES === undefined) delete process.env.DEV_ROUTES_ENABLED;
    else process.env.DEV_ROUTES_ENABLED = ORIG_DEV_ROUTES;
  });

  it('super_admin without DEV_ROUTES_ENABLED → blocked on production', async () => {
    delete process.env.DEV_ROUTES_ENABLED;
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    const res = await proxy(buildReq('/dev/email-test', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/dashboard?denied=1');
  });

  it('super_admin WITH DEV_ROUTES_ENABLED=true → allowed on production', async () => {
    process.env.DEV_ROUTES_ENABLED = 'true';
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    const res = await proxy(buildReq('/dev/email-test', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(200);
  });

  it('captain WITH DEV_ROUTES_ENABLED=true → still blocked (super_admin-only)', async () => {
    process.env.DEV_ROUTES_ENABLED = 'true';
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    const res = await proxy(buildReq('/dev/email-test', { cookie: sess.cookieHeader }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/captain/dashboard?denied=1');
  });
});

describe('proxy: ROLE_HOME redirect targets', () => {
  it('captain bouncing off /admin/x lands at /captain/dashboard', async () => {
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    const res = await proxy(buildReq('/admin/captains', { cookie: sess.cookieHeader }));
    expect(res.headers.get('location')).toMatch(/\/captain\/dashboard\?denied=1$/);
  });

  it('sales_executive bouncing off /admin/x lands at /today', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    const res = await proxy(buildReq('/admin/captains', { cookie: sess.cookieHeader }));
    expect(res.headers.get('location')).toMatch(/\/today\?denied=1$/);
  });
});

// Suppress unused-import noise in the no-city tests above — referenced
// elsewhere; keeps the helper-test wiring obvious.
void getOrCreateCity;
