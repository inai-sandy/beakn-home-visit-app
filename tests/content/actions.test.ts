import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  announcementAcknowledgments,
  announcementCategories,
  announcements,
  auditLog,
  resourceCategories,
  resources,
} from '@/db/schema';
import {
  acknowledgeAnnouncementAction,
  createAnnouncementAction,
  createAnnouncementCategoryAction,
  createResourceAction,
  createResourceCategoryAction,
  setAnnouncementPublishedAction,
  updateAnnouncementCategoryAction,
  updateResourceAction,
  updateResourceCategoryAction,
} from '@/lib/content/actions';

import { loginByPhone } from '../helpers/auth';
import {
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-156 + FIX1 + FIX2: content server actions
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

async function getResourceCategoryBySlug(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: resourceCategories.id })
    .from(resourceCategories)
    .where(eq(resourceCategories.slug, slug))
    .limit(1);
  if (!row) throw new Error(`No resource category with slug ${slug}`);
  return row.id;
}

async function getAnnouncementCategoryBySlug(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: announcementCategories.id })
    .from(announcementCategories)
    .where(eq(announcementCategories.slug, slug))
    .limit(1);
  if (!row) throw new Error(`No announcement category with slug ${slug}`);
  return row.id;
}

// -----------------------------------------------------------------------------
// Resource categories
// -----------------------------------------------------------------------------

describe('createResourceCategoryAction', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await createResourceCategoryAction({
      name: 'New cat',
      sortOrder: 50,
    });
    expect(res.ok).toBe(false);
  });

  it('super_admin inserts a category', async () => {
    await loginAsSuperAdmin('+918888156201');
    const res = await createResourceCategoryAction({
      name: 'Demos',
      sortOrder: 55,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_category_created'));
    expect(audits).toHaveLength(1);
  });
});

describe('updateResourceCategoryAction', () => {
  it('toggles isActive', async () => {
    await loginAsSuperAdmin('+918888156210');
    const id = await getResourceCategoryBySlug('training');
    const res = await updateResourceCategoryAction({
      id,
      name: 'Training',
      sortOrder: 40,
      isActive: false,
    });
    expect(res.ok).toBe(true);
    const [row] = await db
      .select()
      .from(resourceCategories)
      .where(eq(resourceCategories.id, id))
      .limit(1);
    expect(row.isActive).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Announcement categories (FIX2)
// -----------------------------------------------------------------------------

describe('createAnnouncementCategoryAction', () => {
  it('rejects non-super_admin', async () => {
    const cap = await seedCaptain({ phone: '+919000156250' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await createAnnouncementCategoryAction({
      name: 'Captain trying',
      sortOrder: 50,
    });
    expect(res.ok).toBe(false);
  });

  it('super_admin inserts + audit', async () => {
    await loginAsSuperAdmin('+918888156251');
    const res = await createAnnouncementCategoryAction({
      name: 'Field operations',
      sortOrder: 55,
    });
    expect(res.ok).toBe(true);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'announcement_category_created'));
    expect(audits).toHaveLength(1);
  });
});

describe('updateAnnouncementCategoryAction', () => {
  it('renames + emits audit with sparse diff', async () => {
    await loginAsSuperAdmin('+918888156260');
    const id = await getAnnouncementCategoryBySlug('product');
    const res = await updateAnnouncementCategoryAction({
      id,
      name: 'Product updates',
      sortOrder: 40,
      isActive: true,
    });
    expect(res.ok).toBe(true);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'announcement_category_updated'));
    expect(audits).toHaveLength(1);
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('name', 'Product updates');
  });
});

// -----------------------------------------------------------------------------
// Resources (with visibility + tags)
// -----------------------------------------------------------------------------

describe('createResourceAction', () => {
  it('rejects malformed URL', async () => {
    await loginAsSuperAdmin('+918888156300');
    const categoryId = await getResourceCategoryBySlug('pricing');
    const res = await createResourceAction({
      categoryId,
      title: 'Bad URL',
      url: 'not-a-url',
      visibility: 'all',
      tags: [],
    });
    expect(res.ok).toBe(false);
  });

  it('super_admin inserts with visibility + tags + audit', async () => {
    const admin = await loginAsSuperAdmin('+918888156301');
    const categoryId = await getResourceCategoryBySlug('sales-scripts');

    const res = await createResourceAction({
      categoryId,
      title: '1BHK proposal',
      url: 'https://drive.google.com/proposal-1bhk',
      visibility: 'sales_execs_only',
      tags: ['1BHK', '  premium  ', '1bhk'], // mixed case + dups
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, res.data!.resourceId))
      .limit(1);
    expect(row.visibility).toBe('sales_execs_only');
    expect(row.tags).toEqual(['1bhk', 'premium']);
    void admin;
  });
});

describe('updateResourceAction', () => {
  it('updates visibility + tags + audit diff includes both', async () => {
    await loginAsSuperAdmin('+918888156310');
    const scriptsId = await getResourceCategoryBySlug('sales-scripts');

    const created = await createResourceAction({
      categoryId: scriptsId,
      title: 'Original',
      url: 'https://example.test/v1',
      visibility: 'all',
      tags: ['a'],
    });
    if (!created.ok) throw new Error('seed failed');
    const id = created.data!.resourceId;

    const updated = await updateResourceAction({
      id,
      categoryId: scriptsId,
      title: 'Original',
      url: 'https://example.test/v1',
      description: '',
      visibility: 'captains_only',
      tags: ['a', 'b'],
      isPublished: true,
    });
    expect(updated.ok).toBe(true);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_updated'));
    expect(audits).toHaveLength(1);
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('visibility', 'captains_only');
    expect(after).toHaveProperty('tags');
  });
});

// -----------------------------------------------------------------------------
// Announcements (with category + audience + importance + publishDate)
// -----------------------------------------------------------------------------

describe('createAnnouncementAction', () => {
  it('rejects non-super_admin', async () => {
    const cap = await seedCaptain({ phone: '+919000156400' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156400' });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const categoryId = await getAnnouncementCategoryBySlug('operational');
    const res = await createAnnouncementAction({
      categoryId,
      importance: 'info',
      audience: 'both',
      title: 'Should fail',
      body: 'no',
    });
    expect(res.ok).toBe(false);
  });

  it('super_admin inserts + audit captures audience + importance', async () => {
    await loginAsSuperAdmin('+918888156401');
    const categoryId = await getAnnouncementCategoryBySlug('operational');
    const res = await createAnnouncementAction({
      categoryId,
      importance: 'urgent',
      audience: 'captain',
      title: 'Captain only urgent',
      body: 'restricted',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, res.data!.announcementId))
      .limit(1);
    expect(row.importance).toBe('urgent');
    expect(row.audience).toBe('captain');
    expect(row.publishDate).toBeTruthy();

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'announcement_created'));
    expect(audits).toHaveLength(1);
  });
});

describe('setAnnouncementPublishedAction', () => {
  it('toggles published flag', async () => {
    await loginAsSuperAdmin('+918888156410');
    const categoryId = await getAnnouncementCategoryBySlug('operational');
    const created = await createAnnouncementAction({
      categoryId,
      importance: 'info',
      audience: 'both',
      title: 'Toggle me',
      body: 'x',
    });
    if (!created.ok) throw new Error('seed failed');
    const off = await setAnnouncementPublishedAction({
      id: created.data!.announcementId,
      isPublished: false,
    });
    expect(off.ok).toBe(true);
  });
});

describe('acknowledgeAnnouncementAction', () => {
  it('inserts one ack row + audit; second call is a no-op', async () => {
    await loginAsSuperAdmin('+918888156500');
    const categoryId = await getAnnouncementCategoryBySlug('operational');
    const created = await createAnnouncementAction({
      categoryId,
      importance: 'info',
      audience: 'both',
      title: 'Ack me',
      body: 'x',
    });
    if (!created.ok) throw new Error('seed failed');

    const cap = await seedCaptain({ phone: '+919000156500' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const first = await acknowledgeAnnouncementAction({
      announcementId: created.data!.announcementId,
    });
    expect(first.ok).toBe(true);

    const rows = await db
      .select()
      .from(announcementAcknowledgments)
      .where(eq(announcementAcknowledgments.userId, cap.id));
    expect(rows).toHaveLength(1);

    // Idempotency
    const second = await acknowledgeAnnouncementAction({
      announcementId: created.data!.announcementId,
    });
    expect(second.ok).toBe(true);
    const rows2 = await db
      .select()
      .from(announcementAcknowledgments)
      .where(eq(announcementAcknowledgments.userId, cap.id));
    expect(rows2).toHaveLength(1);

    // Only one audit event (first ack)
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'announcement_acknowledged'));
    expect(audits).toHaveLength(1);
  });

  it('rejects unpublished announcements', async () => {
    await loginAsSuperAdmin('+918888156501');
    const categoryId = await getAnnouncementCategoryBySlug('operational');
    const created = await createAnnouncementAction({
      categoryId,
      importance: 'info',
      audience: 'both',
      title: 'Unpublished',
      body: 'x',
    });
    if (!created.ok) throw new Error('seed failed');
    await setAnnouncementPublishedAction({
      id: created.data!.announcementId,
      isPublished: false,
    });

    const cap = await seedCaptain({ phone: '+919000156501' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await acknowledgeAnnouncementAction({
      announcementId: created.data!.announcementId,
    });
    expect(res.ok).toBe(false);
  });
});
