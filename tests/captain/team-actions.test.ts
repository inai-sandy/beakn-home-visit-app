import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, salesExecutives } from '@/db/schema';
import { setExecUnavailableAction } from '@/lib/captain/team-actions';

import { loginByPhone } from '../helpers/auth';
import {
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-167: setExecUnavailableAction tests
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

beforeEach(() => {
  currentCookieHeader = undefined;
});

describe('setExecUnavailableAction — auth', () => {
  it('rejects unauthenticated callers', async () => {
    currentCookieHeader = undefined;
    const res = await setExecUnavailableAction({
      execUserId: '00000000-0000-7000-8000-000000000000',
      isUnavailable: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign/i);
  });

  it('rejects a captain trying to flip another captain\'s exec', async () => {
    const capA = await seedCaptain({
      phone: '+919006000001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919006000002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919106000001',
      fullName: 'Exec A',
    });
    const sessB = await loginByPhone(capB.phone, capB.password);
    currentCookieHeader = sessB.cookieHeader;

    const res = await setExecUnavailableAction({
      execUserId: execA.id,
      isUnavailable: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not allowed/i);
  });
});

describe('setExecUnavailableAction — happy path', () => {
  it('flips the flag and writes an exec_availability_changed audit row', async () => {
    const cap = await seedCaptain({
      phone: '+919006100001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919106100001',
      fullName: 'Exec',
    });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await setExecUnavailableAction({
      execUserId: exec.id,
      isUnavailable: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toBe(true);

    const [row] = await db
      .select({ isUnavailable: salesExecutives.isUnavailable })
      .from(salesExecutives)
      .where(eq(salesExecutives.userId, exec.id))
      .limit(1);
    expect(row.isUnavailable).toBe(true);

    const audits = await db
      .select({
        eventType: auditLog.eventType,
        actorRole: auditLog.actorRole,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'exec_availability_changed'),
          eq(auditLog.targetEntityId, exec.id),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].actorRole).toBe('captain');
  });

  it('no-op when value already matches', async () => {
    const cap = await seedCaptain({
      phone: '+919006200001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919106200001',
      fullName: 'Exec',
    });
    // Pre-set to true; flipping to true again should no-op.
    await db
      .update(salesExecutives)
      .set({ isUnavailable: true })
      .where(eq(salesExecutives.userId, exec.id));

    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await setExecUnavailableAction({
      execUserId: exec.id,
      isUnavailable: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toBe(false);

    // No audit row written.
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'exec_availability_changed'),
          eq(auditLog.targetEntityId, exec.id),
        ),
      );
    expect(audits.length).toBe(0);
  });

  it('super_admin can flip any active exec', async () => {
    const cap = await seedCaptain({
      phone: '+919006300001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919106300001',
      fullName: 'Exec',
    });
    const sa = await seedSuperAdmin({
      phone: '+918888200001',
      fullName: 'Admin',
    });
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await setExecUnavailableAction({
      execUserId: exec.id,
      isUnavailable: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.changed).toBe(true);
  });
});
