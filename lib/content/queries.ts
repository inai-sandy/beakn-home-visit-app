import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  announcementReads,
  announcements,
  resources,
  users,
} from '@/db/schema';

import {
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABELS,
  type AnnouncementRow,
  type AnnouncementSeverity,
  type ResourceCategory,
  type ResourceRow,
  type ResourcesGroupedByCategory,
} from './types';

// =============================================================================
// HVA-156: Resources + Announcements — read queries
// =============================================================================
//
// Read auth is delegated to the calling page — both portals (exec + captain)
// can render the surface, both portals call these helpers. The data is
// broadcast-to-all-staff (D4); there's no per-row visibility scoping.
// super_admin also reads through these (they're the author).
//
// Types + label tables live in ./types so client components can import
// them without dragging postgres-js / Drizzle into the browser bundle.
// We re-export the labels here for the existing call-sites that pull
// labels from this module.
// =============================================================================

export {
  RESOURCE_CATEGORY_LABELS,
  type AnnouncementRow,
  type AnnouncementSeverity,
  type ResourceCategory,
  type ResourceRow,
  type ResourcesGroupedByCategory,
} from './types';

/**
 * Read-surface query: every published resource, grouped by category in the
 * canonical category order (sales_scripts → pricing → brand_assets →
 * training → other), newest-first within each group.
 */
export async function loadPublishedResourcesGrouped(): Promise<
  ResourcesGroupedByCategory[]
> {
  const rows = await db
    .select({
      id: resources.id,
      category: resources.category,
      title: resources.title,
      body: resources.body,
      isPublished: resources.isPublished,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
      authorName: users.fullName,
    })
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .where(eq(resources.isPublished, true))
    .orderBy(asc(resources.category), desc(resources.createdAt));

  const groupMap = new Map<ResourceCategory, ResourceRow[]>();
  for (const r of rows) {
    const category = r.category as ResourceCategory;
    if (!groupMap.has(category)) groupMap.set(category, []);
    groupMap.get(category)!.push({
      id: r.id,
      category,
      title: r.title,
      body: r.body,
      isPublished: r.isPublished,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      authorName: r.authorName,
    });
  }

  // Materialise in canonical category order so the UI doesn't need to
  // know the enum's authoring intent.
  return RESOURCE_CATEGORIES.map((category) => ({
    category,
    label: RESOURCE_CATEGORY_LABELS[category],
    rows: groupMap.get(category) ?? [],
  })).filter((g) => g.rows.length > 0);
}

/**
 * Admin-surface query: every resource including unpublished, in newest-
 * first order. Used by the /admin/content/resources/ page.
 */
export async function loadAllResourcesForAdmin(): Promise<ResourceRow[]> {
  const rows = await db
    .select({
      id: resources.id,
      category: resources.category,
      title: resources.title,
      body: resources.body,
      isPublished: resources.isPublished,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
      authorName: users.fullName,
    })
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .orderBy(desc(resources.createdAt));

  return rows.map((r) => ({
    id: r.id,
    category: r.category as ResourceCategory,
    title: r.title,
    body: r.body,
    isPublished: r.isPublished,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    authorName: r.authorName,
  }));
}

/**
 * Read-surface query: every published announcement, LEFT JOIN'd to the
 * viewing user's announcement_reads so each row knows whether they've
 * read it. Newest-published first.
 */
export async function loadPublishedAnnouncementsForUser(
  userId: string,
): Promise<AnnouncementRow[]> {
  const rows = await db
    .select({
      id: announcements.id,
      severity: announcements.severity,
      title: announcements.title,
      body: announcements.body,
      isPublished: announcements.isPublished,
      publishedAt: announcements.publishedAt,
      createdAt: announcements.createdAt,
      authorName: users.fullName,
      readAt: announcementReads.readAt,
    })
    .from(announcements)
    .innerJoin(users, eq(users.id, announcements.createdByUserId))
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.announcementId, announcements.id),
        eq(announcementReads.userId, userId),
      ),
    )
    .where(eq(announcements.isPublished, true))
    .orderBy(desc(announcements.publishedAt));

  return rows.map((r) => ({
    id: r.id,
    severity: r.severity as AnnouncementSeverity,
    title: r.title,
    body: r.body,
    isPublished: r.isPublished,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    authorName: r.authorName,
    isRead: r.readAt !== null,
  }));
}

/**
 * Admin-surface query: every announcement including unpublished. Used by
 * /admin/content/announcements/.
 */
export async function loadAllAnnouncementsForAdmin(): Promise<
  AnnouncementRow[]
> {
  const rows = await db
    .select({
      id: announcements.id,
      severity: announcements.severity,
      title: announcements.title,
      body: announcements.body,
      isPublished: announcements.isPublished,
      publishedAt: announcements.publishedAt,
      createdAt: announcements.createdAt,
      authorName: users.fullName,
    })
    .from(announcements)
    .innerJoin(users, eq(users.id, announcements.createdByUserId))
    .orderBy(desc(announcements.publishedAt));

  return rows.map((r) => ({
    id: r.id,
    severity: r.severity as AnnouncementSeverity,
    title: r.title,
    body: r.body,
    isPublished: r.isPublished,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    authorName: r.authorName,
    // Admin view doesn't care about per-row read state.
    isRead: false,
  }));
}

/**
 * Drives the drawer's unread-count badge. Counts published announcements
 * with no read receipt for this user. Single round-trip; the partial
 * announcements_published_at_idx covers the published filter; the
 * announcement_reads composite PK covers the anti-join lookup.
 */
export async function countUnreadAnnouncementsForUser(
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(announcements)
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.announcementId, announcements.id),
        eq(announcementReads.userId, userId),
      ),
    )
    .where(
      and(
        eq(announcements.isPublished, true),
        isNull(announcementReads.userId),
      ),
    );
  return row?.cnt ?? 0;
}
