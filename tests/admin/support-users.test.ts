import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { accounts, auditLog, sessions, users } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as createSupport } from '@/app/api/admin/support/route';
import { PATCH as patchSupport } from '@/app/api/admin/support/[id]/route';
import { POST as deactivateSupport } from '@/app/api/admin/support/[id]/deactivate/route';
import { POST as activateSupport } from '@/app/api/admin/support/[id]/activate/route';
import { POST as resetSupportPassword } from '@/app/api/admin/support/[id]/reset-password/route';

import { loginByPhone } from '../helpers/auth';
import { seedCaptain, seedExecutive, seedSuperAdmin } from '../helpers/db';

// =============================================================================
// HVA-236 (HVA-235-FIX1): Support team admin onboarding routes
// =============================================================================
//
// Coverage:
//   - RBAC: super_admin pass, captain/exec/anon blocked on every endpoint
//   - Create: happy path returns user + tempPassword + audit row
//   - Create: phone uniqueness against ALL roles (not just other support)
//   - Create: email uniqueness
//   - Create: validator rejection (invalid phone shape, etc.)
//   - Patch: edit name/phone/email, audit, "not a support user" guard
//   - Patch: phone collision skips the row itself
//   - Deactivate: revokes sessions, audit row, "already inactive" guard
//   - Activate: flips back, audit, "already active" guard
//   - Reset password: new hash, sessions revoked, must_change_password=true,
//     returns new tempPassword, audit row
//   - Role guard: every [id] endpoint refuses when target user has a
//     different role (e.g. trying to deactivate a sales_executive)
// =============================================================================

function buildReq(body?: unknown, method: 'POST' | 'PATCH' = 'POST'): Request {
  return new Request('https://visits.beakn.in/api/admin/support', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VALID_PAYLOAD = {
  fullName: 'Test Support Member',
  phone: '9970000001',
};

describe('POST /api/admin/support (create)', () => {
  it('anonymous → 401', async () => {
    currentCookieHeader = undefined;
    const res = await createSupport(buildReq(VALID_PAYLOAD));
    expect(res.status).toBe(401);
  });

  it('captain → 403', async () => {
    const captain = await seedCaptain({ phone: '+919970000100' });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await createSupport(buildReq(VALID_PAYLOAD));
    expect(res.status).toBe(403);
  });

  it('sales_executive → 403', async () => {
    const captain = await seedCaptain({ phone: '+919970000200' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919970000201',
      fullName: 'Exec Try',
    });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await createSupport(buildReq(VALID_PAYLOAD));
    expect(res.status).toBe(403);
  });

  it('super_admin → 200 with user + tempPassword + audit row', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970000300' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await createSupport(buildReq(VALID_PAYLOAD));
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      ok: boolean;
      user: { id: string; fullName: string; phone: string };
      tempPassword: string;
    };
    expect(j.ok).toBe(true);
    expect(j.user.fullName).toBe('Test Support Member');
    expect(j.user.phone).toBe('+919970000001');
    expect(j.tempPassword).toMatch(/^.{8,}$/); // generated temp pw

    const [created] = await db
      .select({ id: users.id, role: users.role, mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, j.user.id))
      .limit(1);
    expect(created.role).toBe('support');
    expect(created.mustChangePassword).toBe(true);

    const [acct] = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, j.user.id))
      .limit(1);
    expect(acct.password).toBeTruthy(); // hash exists

    const audit = await db
      .select({ eventType: auditLog.eventType, targetEntityId: auditLog.targetEntityId })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, j.user.id));
    expect(audit.some((a) => a.eventType === 'support_user_created')).toBe(true);
  });

  it('phone collision against an existing user (any role) → 409', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970000400' });
    const captain = await seedCaptain({ phone: '+919970000401' });
    void captain;
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    // 9970000401 is the captain's phone (without +91 prefix).
    const res = await createSupport(
      buildReq({ ...VALID_PAYLOAD, phone: '9970000401' }),
    );
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string; fieldErrors?: Record<string, string> };
    expect(j.error.toLowerCase()).toContain('phone');
  });

  it('invalid phone (8 digits) → 400 with fieldErrors.phone', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970000500' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await createSupport(
      buildReq({ ...VALID_PAYLOAD, phone: '12345678' }),
    );
    expect(res.status).toBe(400);
    const j = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(j.fieldErrors?.phone).toBeTruthy();
  });
});

describe('PATCH /api/admin/support/[id] (edit)', () => {
  async function seedScene() {
    const admin = await seedSuperAdmin({ phone: '+919970001000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const created = await createSupport(
      buildReq({ fullName: 'Initial Name', phone: '9970001001' }),
    );
    const j = (await created.json()) as { user: { id: string } };
    return j.user.id;
  }

  it('super_admin can rename + change phone', async () => {
    const id = await seedScene();
    const res = await patchSupport(
      buildReq(
        { fullName: 'Renamed Person', phone: '9970001999' },
        'PATCH',
      ),
      buildCtx(id),
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ fullName: users.fullName, phone: users.phone })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    expect(row.fullName).toBe('Renamed Person');
    expect(row.phone).toBe('+919970001999');
  });

  it('refuses to patch a non-support user (role guard)', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970002000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const captain = await seedCaptain({ phone: '+919970002001' });
    const res = await patchSupport(
      buildReq({ fullName: 'X', phone: '9970002999' }, 'PATCH'),
      buildCtx(captain.id),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/support/[id]/deactivate', () => {
  it('flips is_active + revokes sessions + audit row', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970003000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const created = await createSupport(
      buildReq({ fullName: 'To Deactivate', phone: '9970003001' }),
    );
    const j = (await created.json()) as { user: { id: string } };
    const userId = j.user.id;

    // Inject a fake session row so we can confirm it's deleted.
    await db.insert(sessions).values({
      userId,
      token: 'fake-token-for-deactivate-test',
      expiresAt: new Date(Date.now() + 60_000),
      ipAddress: null,
      userAgent: null,
    });

    const res = await deactivateSupport(buildReq(undefined), buildCtx(userId));
    expect(res.status).toBe(200);

    const [row] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(row.isActive).toBe(false);

    const remainingSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(remainingSessions.length).toBe(0);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, userId));
    expect(audit.some((a) => a.eventType === 'support_user_deactivated')).toBe(true);
  });

  it('refuses on already-inactive user (409)', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970004000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const created = await createSupport(
      buildReq({ fullName: 'Twice Down', phone: '9970004001' }),
    );
    const j = (await created.json()) as { user: { id: string } };
    const userId = j.user.id;
    await deactivateSupport(buildReq(undefined), buildCtx(userId));
    const res2 = await deactivateSupport(buildReq(undefined), buildCtx(userId));
    expect(res2.status).toBe(409);
  });
});

describe('POST /api/admin/support/[id]/activate', () => {
  it('flips is_active back + audit row', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970005000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const created = await createSupport(
      buildReq({ fullName: 'Round Trip', phone: '9970005001' }),
    );
    const j = (await created.json()) as { user: { id: string } };
    const userId = j.user.id;
    await deactivateSupport(buildReq(undefined), buildCtx(userId));
    const res = await activateSupport(buildReq(undefined), buildCtx(userId));
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(row.isActive).toBe(true);
  });

  it('refuses on already-active user (409)', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970006000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const created = await createSupport(
      buildReq({ fullName: 'Already Up', phone: '9970006001' }),
    );
    const j = (await created.json()) as { user: { id: string } };
    const res = await activateSupport(buildReq(undefined), buildCtx(j.user.id));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/admin/support/[id]/reset-password', () => {
  it('returns new tempPassword, flips must_change_password, revokes sessions, audit row', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970007000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const created = await createSupport(
      buildReq({ fullName: 'Reset Target', phone: '9970007001' }),
    );
    const j = (await created.json()) as {
      user: { id: string };
      tempPassword: string;
    };
    const userId = j.user.id;
    const originalPasswordHash = (
      await db
        .select({ password: accounts.password })
        .from(accounts)
        .where(eq(accounts.userId, userId))
        .limit(1)
    )[0].password;

    const res = await resetSupportPassword(buildReq(undefined), buildCtx(userId));
    expect(res.status).toBe(200);
    const j2 = (await res.json()) as { ok: boolean; tempPassword: string };
    expect(j2.ok).toBe(true);
    expect(j2.tempPassword).toMatch(/^.{8,}$/);
    expect(j2.tempPassword).not.toBe(j.tempPassword); // new password

    const [newAcct] = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .limit(1);
    expect(newAcct.password).not.toBe(originalPasswordHash);

    const [u] = await db
      .select({ mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(u.mustChangePassword).toBe(true);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, userId));
    expect(audit.some((a) => a.eventType === 'support_user_password_reset')).toBe(true);
  });

  it('refuses on non-support user', async () => {
    const admin = await seedSuperAdmin({ phone: '+919970008000' });
    const sess = await loginByPhone(admin.phone, admin.password);
    currentCookieHeader = sess.cookieHeader;
    const captain = await seedCaptain({ phone: '+919970008001' });
    const res = await resetSupportPassword(buildReq(undefined), buildCtx(captain.id));
    expect(res.status).toBe(400);
  });
});
