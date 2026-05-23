import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { announcementReads, announcements, auditLog, resources } from '@/db/schema';
import {
  createAnnouncementAction,
  createResourceAction,
  markAllAnnouncementsReadAction,
  setAnnouncementPublishedAction,
  updateResourceAction,
} from '@/lib/content/actions';

import { loginByPhone } from '../helpers/auth';
import {
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-156: content server actions
// =============================================================================
//
// Mirrors tests/notes/actions.test.ts — same headers mock + loginByPhone
// flow drives the cookie that getServerSession reads.
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

async function loginAsSuperAdmin(phone = '+918888156100') {
  const admin = await seedSuperAdmin({ phone });
  const sess = await loginByPhone(admin.phone, admin.password);
  currentCookieHeader = sess.cookieHeader;
  return admin;
}

describe('createResourceAction', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await createResourceAction({
      category: 'pricing',
      title: 'Anything',
      body: 'Anything',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign/i);
  });

  it('rejects non-super_admin (captain)', async () => {
    const cap = await seedCaptain({ phone: '+919000156100' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await createResourceAction({
      category: 'pricing',
      title: 'Captain trying',
      body: 'Should fail',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/forbidden/i);
  });

  it('super_admin inserts a resource and emits a resource_created audit event', async () => {
    const admin = await loginAsSuperAdmin();
    const res = await createResourceAction({
      category: 'sales_scripts',
      title: 'New cold script',
      body: 'opener line',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, res.data!.resourceId))
      .limit(1);
    expect(row.title).toBe('New cold script');
    expect(row.category).toBe('sales_scripts');
    expect(row.createdByUserId).toBe(admin.id);
    expect(row.isPublished).toBe(true);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_created'));
    expect(audits).toHaveLength(1);
    expect(audits[0].targetEntityId).toBe(res.data!.resourceId);
  });

  it('rejects too-short title via zod', async () => {
    await loginAsSuperAdmin('+918888156101');
    const res = await createResourceAction({
      category: 'pricing',
      title: 'ab',
      body: 'ok',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/title/i);
  });
});

describe('updateResourceAction', () => {
  it('updates only changed fields and emits a resource_updated audit event', async () => {
    const admin = await loginAsSuperAdmin('+918888156110');

    const created = await createResourceAction({
      category: 'pricing',
      title: 'Original',
      body: 'first body',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data!.resourceId;

    const updated = await updateResourceAction({
      id,
      category: 'pricing',
      title: 'Updated title',
      body: 'first body', // unchanged
      isPublished: false, // toggled off
    });
    expect(updated.ok).toBe(true);

    const [row] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, id))
      .limit(1);
    expect(row.title).toBe('Updated title');
    expect(row.isPublished).toBe(false);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_updated'));
    expect(audits).toHaveLength(1);
    // Sparse diff: title + isPublished changed, body + category unchanged.
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('title', 'Updated title');
    expect(after).toHaveProperty('isPublished', false);
    expect(after).not.toHaveProperty('body');
    expect(after).not.toHaveProperty('category');
    void admin;
  });

  it('is a no-op (no audit emit) when nothing changes', async () => {
    await loginAsSuperAdmin('+918888156111');
    const created = await createResourceAction({
      category: 'pricing',
      title: 'Same',
      body: 'same',
    });
    if (!created.ok) throw new Error('seed failed');
    const id = created.data!.resourceId;

    const res = await updateResourceAction({
      id,
      category: 'pricing',
      title: 'Same',
      body: 'same',
      isPublished: true,
    });
    expect(res.ok).toBe(true);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_updated'));
    expect(audits).toHaveLength(0);
  });
});

describe('createAnnouncementAction', () => {
  it('rejects non-super_admin (exec)', async () => {
    const cap = await seedCaptain({ phone: '+919000156120' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156120' });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await createAnnouncementAction({
      severity: 'info',
      title: 'Should fail',
      body: 'not allowed',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/forbidden/i);
  });

  it('super_admin appends an announcement and emits announcement_created', async () => {
    await loginAsSuperAdmin('+918888156121');
    const res = await createAnnouncementAction({
      severity: 'urgent',
      title: 'Outage',
      body: 'API is degraded',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, res.data!.announcementId))
      .limit(1);
    expect(row.severity).toBe('urgent');
    expect(row.isPublished).toBe(true);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'announcement_created'));
    expect(audits).toHaveLength(1);
  });
});

describe('setAnnouncementPublishedAction', () => {
  it('toggles the published flag', async () => {
    await loginAsSuperAdmin('+918888156130');
    const created = await createAnnouncementAction({
      severity: 'info',
      title: 'Toggle me',
      body: 'x',
    });
    if (!created.ok) throw new Error('seed failed');
    const id = created.data!.announcementId;

    const off = await setAnnouncementPublishedAction({ id, isPublished: false });
    expect(off.ok).toBe(true);
    {
      const [row] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, id))
        .limit(1);
      expect(row.isPublished).toBe(false);
    }

    const on = await setAnnouncementPublishedAction({ id, isPublished: true });
    expect(on.ok).toBe(true);
    {
      const [row] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, id))
        .limit(1);
      expect(row.isPublished).toBe(true);
    }
  });
});

describe('markAllAnnouncementsReadAction', () => {
  it('inserts read receipts for every published announcement', async () => {
    // Author + admin session creates announcements first.
    const admin = await loginAsSuperAdmin('+918888156140');
    const a1 = await createAnnouncementAction({
      severity: 'info',
      title: 'Announcement one',
      body: 'x',
    });
    const a2 = await createAnnouncementAction({
      severity: 'info',
      title: 'Announcement two',
      body: 'y',
    });
    if (!a1.ok || !a2.ok) throw new Error('seed failed');

    // Swap session to a captain who is now reading the page.
    const cap = await seedCaptain({ phone: '+919000156140' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await markAllAnnouncementsReadAction();
    expect(res.ok).toBe(true);

    const reads = await db
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.userId, cap.id));
    expect(reads).toHaveLength(2);

    // Calling again is a no-op (idempotent via ON CONFLICT DO NOTHING).
    const again = await markAllAnnouncementsReadAction();
    expect(again.ok).toBe(true);
    const reads2 = await db
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.userId, cap.id));
    expect(reads2).toHaveLength(2);

    void admin;
  });

  it('rejects unauthenticated callers', async () => {
    const res = await markAllAnnouncementsReadAction();
    expect(res.ok).toBe(false);
  });

  it('is a no-op (ok=true, no rows) when nothing is published', async () => {
    const cap = await seedCaptain({ phone: '+919000156141' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await markAllAnnouncementsReadAction();
    expect(res.ok).toBe(true);

    const reads = await db
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.userId, cap.id));
    expect(reads).toHaveLength(0);
  });
});

// Tail import that vitest collapsed away
void and;
