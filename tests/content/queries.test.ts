import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  announcementAcknowledgments,
  announcementCategories,
  announcements,
  resourceCategories,
  resources,
} from '@/db/schema';
import {
  countUnreadAnnouncementsForUser,
  loadActiveAnnouncementCategories,
  loadActiveResourceCategories,
  loadAllAnnouncementCategoriesForAdmin,
  loadAllAnnouncementsForAdmin,
  loadAllResourceCategoriesForAdmin,
  loadAllResourcesForAdmin,
  loadPublishedAnnouncementsForUser,
  loadPublishedResourcesByTag,
  loadPublishedResourcesForRole,
} from '@/lib/content/queries';

import {
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-156 + FIX1 + FIX2: content read queries
// =============================================================================

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

async function seedResource(input: {
  categoryId: string;
  title: string;
  url: string;
  description?: string | null;
  visibility?: 'all' | 'captains_only' | 'sales_execs_only';
  tags?: string[];
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
      visibility: input.visibility ?? 'all',
      tags: input.tags ?? [],
      createdByUserId: input.createdByUserId,
      isPublished: input.isPublished ?? true,
    })
    .returning({ id: resources.id });
  return row.id;
}

async function seedAnnouncement(input: {
  categoryId: string;
  importance?: 'info' | 'important' | 'urgent';
  audience?: 'sales_executive' | 'captain' | 'both';
  publishDate?: string;
  title: string;
  body: string;
  createdByUserId: string;
  isPublished?: boolean;
}) {
  const [row] = await db
    .insert(announcements)
    .values({
      categoryId: input.categoryId,
      importance: input.importance ?? 'info',
      audience: input.audience ?? 'both',
      publishDate:
        input.publishDate ?? new Date().toISOString().slice(0, 10),
      title: input.title,
      body: input.body,
      createdByUserId: input.createdByUserId,
      isPublished: input.isPublished ?? true,
    })
    .returning({ id: announcements.id });
  return row.id;
}

// -----------------------------------------------------------------------------
// Resource categories
// -----------------------------------------------------------------------------

describe('loadActiveResourceCategories', () => {
  it('returns seed categories in display_order', async () => {
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
    const otherId = await getResourceCategoryBySlug('other');
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
    const otherId = await getResourceCategoryBySlug('other');
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
// Announcement categories (FIX2)
// -----------------------------------------------------------------------------

describe('loadActiveAnnouncementCategories', () => {
  it('returns seed categories in display_order', async () => {
    const rows = await loadActiveAnnouncementCategories();
    expect(rows.map((r) => r.slug)).toEqual([
      'operational',
      'policy',
      'pricing',
      'product',
      'other',
    ]);
  });
});

describe('loadAllAnnouncementCategoriesForAdmin', () => {
  it('returns every announcement category', async () => {
    const rows = await loadAllAnnouncementCategoriesForAdmin();
    expect(rows).toHaveLength(5);
  });
});

// -----------------------------------------------------------------------------
// Resources — visibility scoping + tags
// -----------------------------------------------------------------------------

describe('loadPublishedResourcesForRole', () => {
  it('filters by visibility per role', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156001' });
    const scriptsId = await getResourceCategoryBySlug('sales-scripts');

    await seedResource({
      categoryId: scriptsId,
      title: 'Everyone',
      url: 'https://example.test/all',
      visibility: 'all',
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: scriptsId,
      title: 'Captains only',
      url: 'https://example.test/cap',
      visibility: 'captains_only',
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: scriptsId,
      title: 'Execs only',
      url: 'https://example.test/exec',
      visibility: 'sales_execs_only',
      createdByUserId: admin.id,
    });

    const execRows = await loadPublishedResourcesForRole('sales_executive');
    expect(execRows.map((r) => r.title).sort()).toEqual([
      'Everyone',
      'Execs only',
    ]);

    const captainRows = await loadPublishedResourcesForRole('captain');
    expect(captainRows.map((r) => r.title).sort()).toEqual([
      'Captains only',
      'Everyone',
    ]);

    const adminRows = await loadPublishedResourcesForRole('super_admin');
    expect(adminRows).toHaveLength(3);
  });

  it('returns empty when role is unknown', async () => {
    const rows = await loadPublishedResourcesForRole('not-a-role');
    expect(rows).toEqual([]);
  });
});

describe('loadPublishedResourcesByTag', () => {
  it('returns resources tagged with the queried tag (case-insensitive)', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156002' });
    const catId = await getResourceCategoryBySlug('pricing');

    await seedResource({
      categoryId: catId,
      title: '1BHK proposal',
      url: 'https://example.test/1bhk',
      tags: ['1bhk', 'premium'],
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: catId,
      title: '2BHK proposal',
      url: 'https://example.test/2bhk',
      tags: ['2bhk'],
      createdByUserId: admin.id,
    });
    await seedResource({
      categoryId: catId,
      title: 'Untagged',
      url: 'https://example.test/none',
      tags: [],
      createdByUserId: admin.id,
    });

    const oneBhk = await loadPublishedResourcesByTag('1BHK');
    expect(oneBhk.map((r) => r.title)).toEqual(['1BHK proposal']);
  });
});

describe('loadAllResourcesForAdmin', () => {
  it('includes unpublished + every visibility', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156003' });
    const catId = await getResourceCategoryBySlug('training');
    await seedResource({
      categoryId: catId,
      title: 'Draft',
      url: 'https://example.test/draft',
      visibility: 'captains_only',
      createdByUserId: admin.id,
      isPublished: false,
    });
    await seedResource({
      categoryId: catId,
      title: 'Live',
      url: 'https://example.test/live',
      createdByUserId: admin.id,
      isPublished: true,
    });

    const rows = await loadAllResourcesForAdmin();
    expect(rows).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
// Announcements — audience scoping + ack join
// -----------------------------------------------------------------------------

describe('loadPublishedAnnouncementsForUser', () => {
  it('flags isAcknowledged via the explicit ack join', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156010' });
    const cap = await seedCaptain({ phone: '+919000156010' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156010' });

    const catId = await getAnnouncementCategoryBySlug('operational');
    const a1 = await seedAnnouncement({
      categoryId: catId,
      audience: 'both',
      title: 'Weekly update',
      body: 'all hands',
      createdByUserId: admin.id,
    });
    const a2 = await seedAnnouncement({
      categoryId: catId,
      audience: 'sales_executive',
      importance: 'urgent',
      title: 'Outage',
      body: 'do not panic',
      createdByUserId: admin.id,
    });

    await db.insert(announcementAcknowledgments).values({
      userId: exec.id,
      announcementId: a1,
    });

    const rows = await loadPublishedAnnouncementsForUser(
      exec.id,
      'sales_executive',
    );
    expect(rows).toHaveLength(2);
    const ra1 = rows.find((r) => r.id === a1)!;
    const ra2 = rows.find((r) => r.id === a2)!;
    expect(ra1.isAcknowledged).toBe(true);
    expect(ra2.isAcknowledged).toBe(false);
    expect(ra2.importance).toBe('urgent');
  });

  it('audience filter excludes captain-only rows from execs', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156011' });
    const cap = await seedCaptain({ phone: '+919000156011' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156011' });

    const catId = await getAnnouncementCategoryBySlug('policy');
    await seedAnnouncement({
      categoryId: catId,
      audience: 'captain',
      title: 'Captain memo',
      body: 'private',
      createdByUserId: admin.id,
    });
    await seedAnnouncement({
      categoryId: catId,
      audience: 'sales_executive',
      title: 'Exec memo',
      body: 'private',
      createdByUserId: admin.id,
    });

    const execRows = await loadPublishedAnnouncementsForUser(
      exec.id,
      'sales_executive',
    );
    expect(execRows.map((r) => r.title)).toEqual(['Exec memo']);

    const capRows = await loadPublishedAnnouncementsForUser(
      cap.id,
      'captain',
    );
    expect(capRows.map((r) => r.title)).toEqual(['Captain memo']);
  });

  it('hides future-dated rows until publish_date arrives', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156012' });
    const cap = await seedCaptain({ phone: '+919000156012' });
    const catId = await getAnnouncementCategoryBySlug('product');

    const future = new Date();
    future.setDate(future.getDate() + 10);

    await seedAnnouncement({
      categoryId: catId,
      title: 'Sneak peek',
      body: 'future',
      publishDate: future.toISOString().slice(0, 10),
      createdByUserId: admin.id,
    });
    await seedAnnouncement({
      categoryId: catId,
      title: 'Today',
      body: 'live',
      createdByUserId: admin.id,
    });

    const rows = await loadPublishedAnnouncementsForUser(cap.id, 'captain');
    expect(rows.map((r) => r.title)).toEqual(['Today']);
  });
});

describe('loadAllAnnouncementsForAdmin', () => {
  it('includes unpublished + future rows + ack counts', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156020' });
    const cap = await seedCaptain({ phone: '+919000156020' });
    const exec = await seedExecutive(cap.id, { phone: '+919100156020' });
    const catId = await getAnnouncementCategoryBySlug('operational');

    const a = await seedAnnouncement({
      categoryId: catId,
      audience: 'both',
      title: 'Live',
      body: 'x',
      createdByUserId: admin.id,
    });

    await db.insert(announcementAcknowledgments).values({
      userId: exec.id,
      announcementId: a,
    });

    const rows = await loadAllAnnouncementsForAdmin();
    expect(rows).toHaveLength(1);
    expect(rows[0].ackCount).toBe(1);
    expect(rows[0].ackTotal).toBeGreaterThanOrEqual(2);
  });
});

describe('countUnreadAnnouncementsForUser', () => {
  it('counts published, audience-matching, unacknowledged announcements', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156030' });
    const cap = await seedCaptain({ phone: '+919000156030' });
    const catId = await getAnnouncementCategoryBySlug('operational');

    const a1 = await seedAnnouncement({
      categoryId: catId,
      audience: 'both',
      title: 'One',
      body: 'x',
      createdByUserId: admin.id,
    });
    await seedAnnouncement({
      categoryId: catId,
      audience: 'both',
      title: 'Two',
      body: 'x',
      createdByUserId: admin.id,
    });
    await seedAnnouncement({
      categoryId: catId,
      audience: 'both',
      title: 'Three (unpublished)',
      body: 'x',
      createdByUserId: admin.id,
      isPublished: false,
    });
    await seedAnnouncement({
      categoryId: catId,
      audience: 'sales_executive',
      title: 'Exec-only',
      body: 'x',
      createdByUserId: admin.id,
    });

    // Captain sees two unread (both audience='both'); exec-only hidden.
    expect(await countUnreadAnnouncementsForUser(cap.id, 'captain')).toBe(2);

    await db.insert(announcementAcknowledgments).values({
      userId: cap.id,
      announcementId: a1,
    });
    expect(await countUnreadAnnouncementsForUser(cap.id, 'captain')).toBe(1);
  });

  it('returns 0 when role is unknown', async () => {
    const cap = await seedCaptain({ phone: '+919000156031' });
    expect(await countUnreadAnnouncementsForUser(cap.id, 'unknown')).toBe(0);
  });
});
