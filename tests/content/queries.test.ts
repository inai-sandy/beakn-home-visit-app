import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  announcementReads,
  announcements,
  resourceCategories,
  resources,
} from '@/db/schema';
import {
  countUnreadAnnouncementsForUser,
  loadActiveResourceCategories,
  loadAllAnnouncementsForAdmin,
  loadAllResourceCategoriesForAdmin,
  loadAllResourcesForAdmin,
  loadPublishedAnnouncementsForUser,
  loadPublishedResources,
} from '@/lib/content/queries';

import {
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-156 + HVA-156-FIX1: content read queries
// =============================================================================
//
// Same shape as tests/notes/queries.test.ts — seed via Drizzle, then call
// the helper and assert on shape + ordering. No mocks; real Postgres.
//
// Tests rely on the 5 seeded categories from migration 0033 (re-seeded by
// truncateAll between tests).
// =============================================================================

async function getCategoryBySlug(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: resourceCategories.id })
    .from(resourceCategories)
    .where(eq(resourceCategories.slug, slug))
    .limit(1);
  if (!row) throw new Error(`No category with slug ${slug}`);
  return row.id;
}

async function seedResource(input: {
  categoryId: string;
  title: string;
  url: string;
  description?: string | null;
  createdByUserId: string;
  isPublished?: boolean;
}) {
  const [row] = await db
    .insert(resources)
    .values({
      categoryId: input.categoryId,
      title: input.title,
      url: input.url,
      description: input.description ?? null,
      createdByUserId: input.createdByUserId,
      isPublished: input.isPublished ?? true,
    })
    .returning({ id: resources.id });
  return row.id;
}

async function seedAnnouncement(input: {
  severity: 'info' | 'important' | 'urgent';
  title: string;
  body: string;
  createdByUserId: string;
  isPublished?: boolean;
  publishedAt?: Date;
}) {
  const [row] = await db
    .insert(announcements)
    .values({
      severity: input.severity,
      title: input.title,
      body: input.body,
      createdByUserId: input.createdByUserId,
      isPublished: input.isPublished ?? true,
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    })
    .returning({ id: announcements.id });
  return row.id;
}

// -----------------------------------------------------------------------------
// Resource categories
// -----------------------------------------------------------------------------

describe('loadActiveResourceCategories', () => {
  it('returns the seed categories in sort_order then name', async () => {
    const rows = await loadActiveResourceCategories();
    expect(rows.map((r) => r.name)).toEqual([
      'Sales scripts',
      'Pricing',
      'Brand assets',
      'Training',
      'Other',
    ]);
  });

  it('skips deactivated categories', async () => {
    const otherId = await getCategoryBySlug('other');
    await db
      .update(resourceCategories)
      .set({ isActive: false })
      .where(eq(resourceCategories.id, otherId));

    const rows = await loadActiveResourceCategories();
    expect(rows.find((r) => r.slug === 'other')).toBeUndefined();
    expect(rows).toHaveLength(4);
  });
});

describe('loadAllResourceCategoriesForAdmin', () => {
  it('includes deactivated categories', async () => {
    const otherId = await getCategoryBySlug('other');
    await db
      .update(resourceCategories)
      .set({ isActive: false })
      .where(eq(resourceCategories.id, otherId));

    const rows = await loadAllResourceCategoriesForAdmin();
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.slug === 'other')?.isActive).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Resources — flat list
// -----------------------------------------------------------------------------

describe('loadPublishedResources', () => {
  it('returns only published rows, newest-first, with category joined', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156001' });
    const scriptsId = await getCategoryBySlug('sales-scripts');
    const pricingId = await getCategoryBySlug('pricing');
    const trainingId = await getCategoryBySlug('training');

    await seedResource({
      categoryId: pricingId,
      title: 'Price list Q2',
      url: 'https://drive.google.com/price-q2',
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: scriptsId,
      title: 'Cold call script v1',
      url: 'https://drive.google.com/script-v1',
      description: 'opener line',
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: scriptsId,
      title: 'Cold call script v2',
      url: 'https://drive.google.com/script-v2',
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: trainingId,
      title: 'Draft training deck',
      url: 'https://drive.google.com/draft',
      createdByUserId: admin.id,
      isPublished: false,
    });

    const rows = await loadPublishedResources();
    expect(rows).toHaveLength(3);
    expect(rows[0].title).toBe('Cold call script v2');
    expect(rows[0].categoryName).toBe('Sales scripts');
    expect(rows[0].categorySlug).toBe('sales-scripts');
    expect(rows[0].url).toBe('https://drive.google.com/script-v2');
    expect(rows[0].description).toBeNull();
    expect(rows[1].description).toBe('opener line');
    expect(rows[0].authorName).toBe('Test Super Admin');
  });

  it('returns empty array when nothing is published', async () => {
    const rows = await loadPublishedResources();
    expect(rows).toEqual([]);
  });
});

describe('loadAllResourcesForAdmin', () => {
  it('includes unpublished rows', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156002' });
    const trainingId = await getCategoryBySlug('training');
    const pricingId = await getCategoryBySlug('pricing');
    await seedResource({
      categoryId: trainingId,
      title: 'Draft',
      url: 'https://example.test/draft',
      createdByUserId: admin.id,
      isPublished: false,
    });
    await seedResource({
      categoryId: pricingId,
      title: 'Live',
      url: 'https://example.test/live',
      createdByUserId: admin.id,
      isPublished: true,
    });

    const rows = await loadAllResourcesForAdmin();
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(['Draft', 'Live']);
  });
});

// -----------------------------------------------------------------------------
// Announcements (unchanged from HVA-156)
// -----------------------------------------------------------------------------

describe('loadPublishedAnnouncementsForUser', () => {
  it('flags isRead correctly via the announcement_reads join', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156003' });
    const cap = await seedCaptain({ phone: '+919000156003' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156003' });

    const a1 = await seedAnnouncement({
      severity: 'info',
      title: 'Weekly update',
      body: 'all hands',
      createdByUserId: admin.id,
    });
    const a2 = await seedAnnouncement({
      severity: 'urgent',
      title: 'Outage',
      body: 'do not panic',
      createdByUserId: admin.id,
    });

    await db.insert(announcementReads).values({
      userId: exec.id,
      announcementId: a1,
    });

    const rows = await loadPublishedAnnouncementsForUser(exec.id);
    expect(rows).toHaveLength(2);
    const ra1 = rows.find((r) => r.id === a1)!;
    const ra2 = rows.find((r) => r.id === a2)!;
    expect(ra1.isRead).toBe(true);
    expect(ra2.isRead).toBe(false);
    expect(ra2.severity).toBe('urgent');
  });

  it('excludes unpublished announcements', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156004' });
    const cap = await seedCaptain({ phone: '+919000156004' });

    await seedAnnouncement({
      severity: 'info',
      title: 'Draft',
      body: 'wip',
      createdByUserId: admin.id,
      isPublished: false,
    });
    await seedAnnouncement({
      severity: 'info',
      title: 'Live',
      body: 'shipped',
      createdByUserId: admin.id,
      isPublished: true,
    });

    const rows = await loadPublishedAnnouncementsForUser(cap.id);
    expect(rows.map((r) => r.title)).toEqual(['Live']);
  });
});

describe('loadAllAnnouncementsForAdmin', () => {
  it('includes unpublished rows newest-first', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156005' });
    await seedAnnouncement({
      severity: 'info',
      title: 'Old',
      body: 'x',
      createdByUserId: admin.id,
      publishedAt: new Date('2026-05-01T10:00:00Z'),
    });
    await seedAnnouncement({
      severity: 'urgent',
      title: 'New',
      body: 'y',
      createdByUserId: admin.id,
      isPublished: false,
      publishedAt: new Date('2026-05-20T10:00:00Z'),
    });

    const rows = await loadAllAnnouncementsForAdmin();
    expect(rows.map((r) => r.title)).toEqual(['New', 'Old']);
  });
});

describe('countUnreadAnnouncementsForUser', () => {
  it('counts only published, unread announcements for the user', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156006' });
    const cap = await seedCaptain({ phone: '+919000156006' });

    const a1 = await seedAnnouncement({
      severity: 'info',
      title: 'One',
      body: 'x',
      createdByUserId: admin.id,
    });
    await seedAnnouncement({
      severity: 'info',
      title: 'Two',
      body: 'x',
      createdByUserId: admin.id,
    });
    await seedAnnouncement({
      severity: 'info',
      title: 'Three',
      body: 'x',
      createdByUserId: admin.id,
      isPublished: false,
    });

    expect(await countUnreadAnnouncementsForUser(cap.id)).toBe(2);

    await db.insert(announcementReads).values({
      userId: cap.id,
      announcementId: a1,
    });

    expect(await countUnreadAnnouncementsForUser(cap.id)).toBe(1);
  });

  it('returns 0 when there are no published announcements', async () => {
    const cap = await seedCaptain({ phone: '+919000156007' });
    expect(await countUnreadAnnouncementsForUser(cap.id)).toBe(0);
  });
});
