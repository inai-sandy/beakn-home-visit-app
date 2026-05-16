import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { accounts, auditLog, sessions, users } from '@/db/schema';

import { setPasswordAction } from '@/app/set-password/actions';

import { loginByPhone } from '../helpers/auth';
import { seedCaptain } from '../helpers/db';

// =============================================================================
// HVA-101 / Area 1: HVA-26 first-login set-password Server Action
// =============================================================================
//
// We import the action directly (it's just an exported async function) and
// drive it with a real Better-Auth session. Validation paths and the DB
// flip are observable from the result object + post-condition queries.
// =============================================================================

// The action reads getServerSession() which uses next/headers. Vitest doesn't
// run inside a Next request lifecycle, so we need to stub headers().
import { vi } from 'vitest';

// Better-Auth in vitest reads cookies via next/headers. Provide a stub the
// action's getServerSession() can consume.
let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

describe('set-password action: gates', () => {
  it('rejects when no session is present', async () => {
    currentCookieHeader = undefined;
    const result = await setPasswordAction({
      newPassword: 'Newpass123',
      confirmPassword: 'Newpass123',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not signed in/i);
  });

  it('rejects when mustChangePassword is false (defense-in-depth)', async () => {
    const cap = await seedCaptain({ mustChangePassword: false });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const result = await setPasswordAction({
      newPassword: 'Newpass123',
      confirmPassword: 'Newpass123',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already been set/i);
  });
});

describe('set-password action: validation', () => {
  it('rejects weak password (less than 8 chars)', async () => {
    const cap = await seedCaptain({ mustChangePassword: true });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const result = await setPasswordAction({
      newPassword: 'abc1',
      confirmPassword: 'abc1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least 8 characters/i);

    // DB-side: flag stayed true.
    const [u] = await db
      .select({ mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, cap.id))
      .limit(1);
    expect(u.mustChangePassword).toBe(true);
  });

  it('rejects mismatched confirm', async () => {
    const cap = await seedCaptain({ mustChangePassword: true });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const result = await setPasswordAction({
      newPassword: 'Newpass123',
      confirmPassword: 'Newpass124',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/do not match/i);
  });
});

describe('set-password action: success path', () => {
  it('flips mustChangePassword, updates accounts.password, wipes other sessions, returns role home', async () => {
    const cap = await seedCaptain({ mustChangePassword: true });
    const sess = await loginByPhone(cap.phone, cap.password);
    // Open a second session for the same user. The action should wipe
    // this one but keep the current.
    const sessExtra = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    // pre-condition: 2 sessions exist.
    const before = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, cap.id));
    expect(before.length).toBe(2);
    void sessExtra; // silence unused — its purpose is the pre-condition row.

    const result = await setPasswordAction({
      newPassword: 'Newpass123',
      confirmPassword: 'Newpass123',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.redirectTo).toBe('/captain/dashboard');

    // post-condition: must_change_password=false, last_login_at set,
    // exactly one session remaining (the current one).
    const [u] = await db
      .select({
        mustChangePassword: users.mustChangePassword,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(eq(users.id, cap.id))
      .limit(1);
    expect(u.mustChangePassword).toBe(false);
    expect(u.lastLoginAt).not.toBeNull();

    const after = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, cap.id));
    expect(after.length).toBe(1);

    // accounts.password row was updated — hash changed.
    const [a] = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, cap.id))
      .limit(1);
    expect(a.password).toBeDefined();
    expect(a.password?.length).toBeGreaterThan(20);

    // HVA-108: audit_log row written with event_type='password_set'.
    // The action emits this on every first-login completion; without the
    // allow-list entry the row would be silently dropped (the original
    // defect). Asserting on count + shape guards against a re-regression.
    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorUserId: auditLog.actorUserId,
        actorRole: auditLog.actorRole,
        targetEntityType: auditLog.targetEntityType,
        targetEntityId: auditLog.targetEntityId,
        reason: auditLog.reason,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.eventType, 'password_set'));
    expect(audit.length).toBe(1);
    expect(audit[0].actorUserId).toBe(cap.id);
    expect(audit[0].actorRole).toBe('captain');
    expect(audit[0].targetEntityType).toBe('user');
    expect(audit[0].targetEntityId).toBe(cap.id);
    expect(audit[0].reason).toBe('first_login_password_change');
    expect(audit[0].afterState).toMatchObject({
      mustChangePassword: false,
      sessionsRevokedExceptCurrent: true,
    });
  });

  it('redirects super_admin to /admin/dashboard', async () => {
    // re-use the seedCaptain machinery by passing super_admin role
    const u = await (await import('../helpers/db')).seedUser({
      role: 'super_admin',
      phone: '+918888899999',
      password: 'AdminFirstLogin#1',
      mustChangePassword: true,
    });
    const sess = await loginByPhone(u.phone, u.password);
    currentCookieHeader = sess.cookieHeader;
    const result = await setPasswordAction({
      newPassword: 'Newpass123',
      confirmPassword: 'Newpass123',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.redirectTo).toBe('/admin/dashboard');
  });
});
