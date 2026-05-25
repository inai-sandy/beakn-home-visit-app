import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  announcementReads,
  announcements,
  auditLog,
  resourceCategories,
  resources,
} from '@/db/schema';
import {
  createAnnouncementAction,
  createResourceAction,
  createResourceCategoryAction,
  markAllAnnouncementsReadAction,
  setAnnouncementPublishedAction,
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
// HVA-156 + HVA-156-FIX1: content server actions
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

async function getCategoryBySlug(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: resourceCategories.id })
    .from(resourceCategories)
    .where(eq(resourceCategories.slug, slug))
    .limit(1);
  if (!row) throw new Error(`No category with slug ${slug}`);
  return row.id;
}

// -----------------------------------------------------------------------------
// Resource categories — admin CRUD
// -----------------------------------------------------------------------------

describe('createResourceCategoryAction', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await createResourceCategoryAction({
      name: 'New cat',
      sortOrder: 50,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects non-super_admin (captain)', async () => {
    const cap = await seedCaptain({ phone: '+919000156200' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await createResourceCategoryAction({
      name: 'New cat',
      sortOrder: 50,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/forbidden/i);
  });

  it('super_admin inserts a category with a slugified slug', async () => {
    await loginAsSuperAdmin('+918888156201');
    const res = await createResourceCategoryAction({
      name: 'Customer Testimonials & FAQs',
      sortOrder: 55,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(resourceCategories)
      .where(eq(resourceCategories.id, res.data!.categoryId))
      .limit(1);
    expect(row.name).toBe('Customer Testimonials & FAQs');
    expect(row.slug).toBe('customer-testimonials-faqs');
    expect(row.sortOrder).toBe(55);
    expect(row.isActive).toBe(true);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_category_created'));
    expect(audits).toHaveLength(1);
    expect(audits[0].targetEntityId).toBe(res.data!.categoryId);
  });

  it('rejects duplicate name with friendly error', async () => {
    await loginAsSuperAdmin('+918888156202');
    const res = await createResourceCategoryAction({
      name: 'Sales scripts',
      sortOrder: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already exists/i);
  });
});

describe('updateResourceCategoryAction', () => {
  it('renames + recomputes slug; emits audit with sparse diff', async () => {
    await loginAsSuperAdmin('+918888156210');
    const id = await getCategoryBySlug('other');
    const res = await updateResourceCategoryAction({
      id,
      name: 'Misc',
      sortOrder: 99,
      isActive: true,
    });
    expect(res.ok).toBe(true);

    const [row] = await db
      .select()
      .from(resourceCategories)
      .where(eq(resourceCategories.id, id))
      .limit(1);
    expect(row.name).toBe('Misc');
    expect(row.slug).toBe('misc');

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_category_updated'));
    expect(audits).toHaveLength(1);
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('name', 'Misc');
    expect(after).toHaveProperty('slug', 'misc');
    expect(after).not.toHaveProperty('sortOrder');
    expect(after).not.toHaveProperty('isActive');
  });

  it('toggles isActive without renaming', async () => {
    await loginAsSuperAdmin('+918888156211');
    const id = await getCategoryBySlug('training');
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

  it('is a no-op (no audit emit) when nothing changes', async () => {
    await loginAsSuperAdmin('+918888156212');
    const id = await getCategoryBySlug('pricing');
    const res = await updateResourceCategoryAction({
      id,
      name: 'Pricing',
      sortOrder: 20,
      isActive: true,
    });
    expect(res.ok).toBe(true);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_category_updated'));
    expect(audits).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Resources
// -----------------------------------------------------------------------------

describe('createResourceAction', () => {
  it('rejects unauthenticated callers', async () => {
    const categoryId = await getCategoryBySlug('pricing');
    const res = await createResourceAction({
      categoryId,
      title: 'Anything',
      url: 'https://example.test/x',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects non-super_admin', async () => {
    const cap = await seedCaptain({ phone: '+919000156300' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const categoryId = await getCategoryBySlug('pricing');

    const res = await createResourceAction({
      categoryId,
      title: 'Captain trying',
      url: 'https://example.test/x',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed URL', async () => {
    await loginAsSuperAdmin('+918888156301');
    const categoryId = await getCategoryBySlug('pricing');
    const res = await createResourceAction({
      categoryId,
      title: 'Bad URL',
      url: 'not-a-url',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/url/i);
  });

  it('rejects an inactive category', async () => {
    await loginAsSuperAdmin('+918888156302');
    const categoryId = await getCategoryBySlug('other');
    await db
      .update(resourceCategories)
      .set({ isActive: false })
      .where(eq(resourceCategories.id, categoryId));

    const res = await createResourceAction({
      categoryId,
      title: 'Should reject',
      url: 'https://example.test/x',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/inactive/i);
  });

  it('super_admin inserts a resource + emits resource_created audit', async () => {
    const admin = await loginAsSuperAdmin('+918888156303');
    const categoryId = await getCategoryBySlug('sales-scripts');

    const res = await createResourceAction({
      categoryId,
      title: 'Cold call script',
      url: 'https://drive.google.com/cold-call',
      description: 'For premium customers',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, res.data!.resourceId))
      .limit(1);
    expect(row.title).toBe('Cold call script');
    expect(row.url).toBe('https://drive.google.com/cold-call');
    expect(row.description).toBe('For premium customers');
    expect(row.categoryId).toBe(categoryId);
    expect(row.createdByUserId).toBe(admin.id);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_created'));
    expect(audits).toHaveLength(1);
  });

  it('treats empty description as NULL', async () => {
    await loginAsSuperAdmin('+918888156304');
    const categoryId = await getCategoryBySlug('pricing');
    const res = await createResourceAction({
      categoryId,
      title: 'No description',
      url: 'https://example.test/x',
      description: '',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, res.data!.resourceId))
      .limit(1);
    expect(row.description).toBeNull();
  });
});

describe('updateResourceAction', () => {
  it('updates only changed fields + sparse audit diff', async () => {
    await loginAsSuperAdmin('+918888156310');
    const scriptsId = await getCategoryBySlug('sales-scripts');
    const pricingId = await getCategoryBySlug('pricing');

    const created = await createResourceAction({
      categoryId: scriptsId,
      title: 'Original',
      url: 'https://example.test/v1',
      description: 'original notes',
    });
    if (!created.ok) throw new Error('seed failed');
    const id = created.data!.resourceId;

    const updated = await updateResourceAction({
      id,
      categoryId: pricingId,
      title: 'Original',
      url: 'https://example.test/v2',
      description: 'original notes',
      isPublished: true,
    });
    expect(updated.ok).toBe(true);

    const [row] = await db
      .select()
      .from(resources)
      .where(eq(resources.id, id))
      .limit(1);
    expect(row.categoryId).toBe(pricingId);
    expect(row.url).toBe('https://example.test/v2');

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'resource_updated'));
    expect(audits).toHaveLength(1);
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('categoryId', pricingId);
    expect(after).toHaveProperty('url', 'https://example.test/v2');
    expect(after).not.toHaveProperty('title');
    expect(after).not.toHaveProperty('description');
    expect(after).not.toHaveProperty('isPublished');
  });

  it('allows editing against an inactive category (preserves history)', async () => {
    await loginAsSuperAdmin('+918888156311');
    const trainingId = await getCategoryBySlug('training');

    const created = await createResourceAction({
      categoryId: trainingId,
      title: 'Active-time post',
      url: 'https://example.test/v1',
    });
    if (!created.ok) throw new Error('seed failed');

    await db
      .update(resourceCategories)
      .set({ isActive: false })
      .where(eq(resourceCategories.id, trainingId));

    const res = await updateResourceAction({
      id: created.data!.resourceId,
      categoryId: trainingId,
      title: 'Renamed',
      url: 'https://example.test/v1',
      description: '',
      isPublished: false,
    });
    expect(res.ok).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Announcement actions (unchanged from HVA-156, smoke tests)
// -----------------------------------------------------------------------------

describe('createAnnouncementAction + setAnnouncementPublishedAction', () => {
  it('super_admin creates + toggles published', async () => {
    await loginAsSuperAdmin('+918888156400');
    const created = await createAnnouncementAction({
      severity: 'urgent',
      title: 'Outage',
      body: 'API is degraded',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data!.announcementId;

    const off = await setAnnouncementPublishedAction({ id, isPublished: false });
    expect(off.ok).toBe(true);

    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, id))
      .limit(1);
    expect(row.isPublished).toBe(false);
  });

  it('rejects non-super_admin', async () => {
    const cap = await seedCaptain({ phone: '+919000156400' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156400' });
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await createAnnouncementAction({
      severity: 'info',
      title: 'Should fail',
      body: 'not allowed',
    });
    expect(res.ok).toBe(false);
  });
});

describe('markAllAnnouncementsReadAction', () => {
  it('idempotently inserts read receipts for all published announcements', async () => {
    await loginAsSuperAdmin('+918888156500');
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

    const cap = await seedCaptain({ phone: '+919000156500' });
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await markAllAnnouncementsReadAction();
    expect(res.ok).toBe(true);

    const reads = await db
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.userId, cap.id));
    expect(reads).toHaveLength(2);

    const again = await markAllAnnouncementsReadAction();
    expect(again.ok).toBe(true);
    const reads2 = await db
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.userId, cap.id));
    expect(reads2).toHaveLength(2);
  });
});
