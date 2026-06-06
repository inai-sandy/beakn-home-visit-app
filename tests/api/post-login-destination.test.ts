import { describe, expect, it, vi } from 'vitest';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import { GET } from '@/app/api/auth/post-login-destination/route';
import { db } from '@/db/client';
import { accounts, users } from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import { seedCaptain, seedExecutive, seedSuperAdmin } from '../helpers/db';

// =============================================================================
// HVA-237 (HVA-236-FIX1): /api/auth/post-login-destination
// =============================================================================
//
// Login-form follow-up endpoint that decides where to send the user
// immediately after sign-in. Each role's case is locked here so a
// future role addition can't silently fall through to the `default`
// (which bounces to `/` and ends up on `/request` per proxy.ts).

async function seedSupportUser(): Promise<{ phone: string; password: string }> {
  const phone = `+91990000${Math.floor(Math.random() * 9000 + 1000)}`;
  const password = 'SupportTest#1';
  const hash = await hashPassword(password);
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: 'Test Support',
      phone,
      phoneVerified: true,
      isActive: true,
      mustChangePassword: false,
    })
    .returning({ id: users.id });
  await db.insert(accounts).values({
    accountId: u.id,
    providerId: 'credential',
    userId: u.id,
    password: hash,
  });
  return { phone, password };
}

describe('GET /api/auth/post-login-destination', () => {
  it('anonymous → 401 with /login destination', async () => {
    currentCookieHeader = undefined;
    const res = await GET();
    expect(res.status).toBe(401);
    const j = (await res.json()) as { destination: string };
    expect(j.destination).toBe('/login');
  });

  it('captain → /captain/dashboard', async () => {
    const captain = await seedCaptain({ phone: '+919970020001' });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await GET();
    const j = (await res.json()) as { destination: string };
    expect(j.destination).toBe('/captain/dashboard');
  });

  it('super_admin → /admin/dashboard', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970020002' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await GET();
    const j = (await res.json()) as { destination: string };
    expect(j.destination).toBe('/admin/dashboard');
  });

  it('sales_executive (no day plan today) → /today', async () => {
    const captain = await seedCaptain({ phone: '+919970020003' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919970020004',
      fullName: 'Exec No Plan',
    });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await GET();
    const j = (await res.json()) as { destination: string };
    expect(j.destination).toBe('/today');
  });

  it('support → /support (HVA-237 fix)', async () => {
    const support = await seedSupportUser();
    const sess = await loginByPhone(support.phone, support.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await GET();
    const j = (await res.json()) as { destination: string };
    expect(j.destination).toBe('/support');
  });
});
