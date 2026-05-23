import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { announcementReads, announcements, resources } from '@/db/schema';
import {
  countUnreadAnnouncementsForUser,
  loadAllAnnouncementsForAdmin,
  loadAllResourcesForAdmin,
  loadPublishedAnnouncementsForUser,
  loadPublishedResourcesGrouped,
} from '@/lib/content/queries';

import {
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-156: content read queries
// =============================================================================
//
// Same shape as tests/notes/queries.test.ts — seed via Drizzle, then call
// the helper and assert on shape + ordering. No mocks; real Postgres.
// =============================================================================

async function seedResource(input: {
  category: 'sales_scripts' | 'pricing' | 'brand_assets' | 'training' | 'other';
  title: string;
  body: string;
  createdByUserId: string;
  isPublished?: boolean;
  createdAt?: Date;
}) {
  const [row] = await db
    .insert(resources)
    .values({
      category: input.category,
      title: input.title,
      body: input.body,
      createdByUserId: input.createdByUserId,
      isPublished: input.isPublished ?? true,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
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

describe('loadPublishedResourcesGrouped', () => {
  it('returns only published rows, grouped by category in canonical order', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156001' });

    await seedResource({
      category: 'pricing',
      title: 'Price list Q2',
      body: 'paid plans',
      createdByUserId: admin.id,
    });
    await seedResource({
      category: 'sales_scripts',
      title: 'Cold call script v1',
      body: 'opener line',
      createdByUserId: admin.id,
    });
    await seedResource({
      category: 'sales_scripts',
      title: 'Cold call script v2',
      body: 'refined opener',
      createdByUserId: admin.id,
    });
    // Unpublished — must be filtered out.
    await seedResource({
      category: 'training',
      title: 'Draft training deck',
      body: 'wip',
      createdByUserId: admin.id,
      isPublished: false,
    });

    const groups = await loadPublishedResourcesGrouped();

    // Canonical category order is sales_scripts → pricing → brand_assets →
    // training → other; empty groups are filtered, so we expect 2 groups.
    expect(groups.map((g) => g.category)).toEqual(['sales_scripts', 'pricing']);

    const scripts = groups.find((g) => g.category === 'sales_scripts')!;
    expect(scripts.rows).toHaveLength(2);
    // Newest-first within each group.
    expect(scripts.rows[0].title).toBe('Cold call script v2');
    expect(scripts.rows[1].title).toBe('Cold call script v1');

    const pricing = groups.find((g) => g.category === 'pricing')!;
    expect(pricing.rows).toHaveLength(1);
    expect(pricing.rows[0].title).toBe('Price list Q2');
    expect(pricing.rows[0].authorName).toBe('Test Super Admin');
  });

  it('returns empty array when no resources are published', async () => {
    const groups = await loadPublishedResourcesGrouped();
    expect(groups).toEqual([]);
  });
});

describe('loadAllResourcesForAdmin', () => {
  it('includes unpublished rows', async () => {
    const admin = await seedSuperAdmin({ phone: '+918888156002' });
    await seedResource({
      category: 'training',
      title: 'Draft',
      body: 'wip',
      createdByUserId: admin.id,
      isPublished: false,
    });
    await seedResource({
      category: 'pricing',
      title: 'Live',
      body: 'shipped',
      createdByUserId: admin.id,
      isPublished: true,
    });

    const rows = await loadAllResourcesForAdmin();
    expect(rows).toHaveLength(2);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(['Draft', 'Live']);
  });
});

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

    // exec has read a1 but not a2.
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
    // Unpublished — must not be counted.
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
