import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  announcementReads,
  announcements,
  resourceCategories,
  resources,
  users,
} from '@/db/schema';

import {
  type AnnouncementRow,
  type AnnouncementSeverity,
  type ResourceCategoryRow,
  type ResourceRow,
} from './types';

// =============================================================================
// HVA-156 + HVA-156-FIX1: Resources + Announcements — read queries
// =============================================================================
//
// Read auth is delegated to the calling page — both portals (exec + captain)
// can render the surface, both portals call these helpers. The data is
// broadcast-to-all-staff; there's no per-row visibility scoping.
// super_admin also reads through these (they're the author).
//
// FIX1: the read surface is now flat (no grouped accordion). Categories
// come from an admin-managed table; the filter dropdown reads
// loadActiveResourceCategories and the list reads loadPublishedResources.
//
// Types live in ./types so client components can import them without
// pulling postgres-js into the browser bundle.
// =============================================================================

export {
  type AnnouncementRow,
  type AnnouncementSeverity,
  type ResourceCategoryRow,
  type ResourceRow,
} from './types';

// -----------------------------------------------------------------------------
// Resource categories
// -----------------------------------------------------------------------------

/** Active categories in display order — drives the filter dropdown. */
export async function loadActiveResourceCategories(): Promise<
  ResourceCategoryRow[]
> {
  return db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      slug: resourceCategories.slug,
      sortOrder: resourceCategories.sortOrder,
      isActive: resourceCategories.isActive,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .where(eq(resourceCategories.isActive, true))
    .orderBy(asc(resourceCategories.sortOrder), asc(resourceCategories.name));
}

/** Every category (including deactivated) — drives the admin CRUD list. */
export async function loadAllResourceCategoriesForAdmin(): Promise<
  ResourceCategoryRow[]
> {
  return db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      slug: resourceCategories.slug,
      sortOrder: resourceCategories.sortOrder,
      isActive: resourceCategories.isActive,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .orderBy(asc(resourceCategories.sortOrder), asc(resourceCategories.name));
}

// -----------------------------------------------------------------------------
// Resources — flat list with category join
// -----------------------------------------------------------------------------

/**
 * Read-surface query: every published resource, newest-first, with its
 * category name + slug joined. The UI filters by category client-side
 * (small dataset; one admin posts a handful per week) and runs a
 * title-contains search box against the same client copy.
 */
export async function loadPublishedResources(): Promise<ResourceRow[]> {
  const rows = await db
    .select({
      id: resources.id,
      categoryId: resources.categoryId,
      categoryName: resourceCategories.name,
      categorySlug: resourceCategories.slug,
      title: resources.title,
      url: resources.url,
      description: resources.description,
      isPublished: resources.isPublished,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
      authorName: users.fullName,
    })
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .innerJoin(
      resourceCategories,
      eq(resourceCategories.id, resources.categoryId),
    )
    .where(eq(resources.isPublished, true))
    .orderBy(desc(resources.createdAt));

  return rows;
}

/**
 * Admin-surface query: every resource (including unpublished). Used by
 * /admin/content/resources/.
 */
export async function loadAllResourcesForAdmin(): Promise<ResourceRow[]> {
  const rows = await db
    .select({
      id: resources.id,
      categoryId: resources.categoryId,
      categoryName: resourceCategories.name,
      categorySlug: resourceCategories.slug,
      title: resources.title,
      url: resources.url,
      description: resources.description,
      isPublished: resources.isPublished,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
      authorName: users.fullName,
    })
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .innerJoin(
      resourceCategories,
      eq(resourceCategories.id, resources.categoryId),
    )
    .orderBy(desc(resources.createdAt));

  return rows;
}

// -----------------------------------------------------------------------------
// Announcements (unchanged from HVA-156)
// -----------------------------------------------------------------------------

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
    isRead: false,
  }));
}

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
