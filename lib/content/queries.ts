import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  announcementAcknowledgments,
  announcementCategories,
  announcements,
  resourceCategories,
  resources,
  users,
} from '@/db/schema';

import {
  type AnnouncementAudience,
  type AnnouncementCategoryRow,
  type AnnouncementImportance,
  type AnnouncementRow,
  type ResourceCategoryRow,
  type ResourceRow,
  type ResourceVisibility,
} from './types';
import { allowedAudiencesForRole } from '@/lib/announcements/audience';
import { allowedVisibilitiesForRole } from '@/lib/resources/visibility';

// =============================================================================
// HVA-156 + HVA-156-FIX1 + HVA-156-FIX2: Resources + Announcements queries
// =============================================================================
//
// Read auth is delegated to the calling page — both portals (exec + captain)
// can render the surface; the helper accepts viewerRole and filters
// visibility/audience accordingly.
//
// Types live in ./types so client components can import them without
// pulling postgres-js into the browser bundle.
// =============================================================================

export {
  type AnnouncementAudience,
  type AnnouncementCategoryRow,
  type AnnouncementImportance,
  type AnnouncementRow,
  type AnnouncementSeverity,
  type ResourceCategoryRow,
  type ResourceRow,
  type ResourceVisibility,
} from './types';

// -----------------------------------------------------------------------------
// Resource categories
// -----------------------------------------------------------------------------

export async function loadActiveResourceCategories(): Promise<
  ResourceCategoryRow[]
> {
  return db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      slug: resourceCategories.slug,
      sortOrder: resourceCategories.sortOrder,
      displayOrder: resourceCategories.displayOrder,
      isActive: resourceCategories.isActive,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .where(eq(resourceCategories.isActive, true))
    .orderBy(asc(resourceCategories.displayOrder), asc(resourceCategories.name));
}

export async function loadAllResourceCategoriesForAdmin(): Promise<
  ResourceCategoryRow[]
> {
  return db
    .select({
      id: resourceCategories.id,
      name: resourceCategories.name,
      slug: resourceCategories.slug,
      sortOrder: resourceCategories.sortOrder,
      displayOrder: resourceCategories.displayOrder,
      isActive: resourceCategories.isActive,
      createdAt: resourceCategories.createdAt,
      updatedAt: resourceCategories.updatedAt,
    })
    .from(resourceCategories)
    .orderBy(asc(resourceCategories.displayOrder), asc(resourceCategories.name));
}

// -----------------------------------------------------------------------------
// Announcement categories
// -----------------------------------------------------------------------------

export async function loadActiveAnnouncementCategories(): Promise<
  AnnouncementCategoryRow[]
> {
  return db
    .select({
      id: announcementCategories.id,
      name: announcementCategories.name,
      slug: announcementCategories.slug,
      sortOrder: announcementCategories.sortOrder,
      displayOrder: announcementCategories.displayOrder,
      isActive: announcementCategories.isActive,
      createdAt: announcementCategories.createdAt,
      updatedAt: announcementCategories.updatedAt,
    })
    .from(announcementCategories)
    .where(eq(announcementCategories.isActive, true))
    .orderBy(
      asc(announcementCategories.displayOrder),
      asc(announcementCategories.name),
    );
}

export async function loadAllAnnouncementCategoriesForAdmin(): Promise<
  AnnouncementCategoryRow[]
> {
  return db
    .select({
      id: announcementCategories.id,
      name: announcementCategories.name,
      slug: announcementCategories.slug,
      sortOrder: announcementCategories.sortOrder,
      displayOrder: announcementCategories.displayOrder,
      isActive: announcementCategories.isActive,
      createdAt: announcementCategories.createdAt,
      updatedAt: announcementCategories.updatedAt,
    })
    .from(announcementCategories)
    .orderBy(
      asc(announcementCategories.displayOrder),
      asc(announcementCategories.name),
    );
}

// -----------------------------------------------------------------------------
// Resources — flat list with category join + visibility scoping
// -----------------------------------------------------------------------------

function rowToResource(r: {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  title: string;
  url: string;
  description: string | null;
  visibility: string;
  tags: string[] | null;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  authorName: string | null;
}): ResourceRow {
  return {
    id: r.id,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categorySlug: r.categorySlug,
    title: r.title,
    url: r.url,
    description: r.description,
    visibility: r.visibility as ResourceVisibility,
    tags: r.tags ?? [],
    isPublished: r.isPublished,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    authorName: r.authorName,
  };
}

const RESOURCE_SELECT = {
  id: resources.id,
  categoryId: resources.categoryId,
  categoryName: resourceCategories.name,
  categorySlug: resourceCategories.slug,
  title: resources.title,
  url: resources.url,
  description: resources.description,
  visibility: resources.visibility,
  tags: resources.tags,
  isPublished: resources.isPublished,
  createdAt: resources.createdAt,
  updatedAt: resources.updatedAt,
  authorName: users.fullName,
};

/**
 * Read-surface query for a given viewer role. Filters by is_published +
 * the visibility values this role is allowed to see. Newest-first.
 */
export async function loadPublishedResourcesForRole(
  viewerRole: string | undefined,
): Promise<ResourceRow[]> {
  const allowed = allowedVisibilitiesForRole(viewerRole);
  if (allowed.length === 0) return [];
  const rows = await db
    .select(RESOURCE_SELECT)
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .innerJoin(
      resourceCategories,
      eq(resourceCategories.id, resources.categoryId),
    )
    .where(
      and(
        eq(resources.isPublished, true),
        inArray(resources.visibility, allowed),
      ),
    )
    .orderBy(desc(resources.createdAt));
  return rows.map(rowToResource);
}

/**
 * HVA-37 helper: lookup published resources tagged with a given tag,
 * scoped by viewer role. Used to find BHK-matched proposal links on
 * the customer tracking page.
 *
 * Tag match is case-insensitive — the DB stores whatever the admin
 * typed, the query lowercases on both sides.
 */
export async function loadPublishedResourcesByTag(
  tag: string,
  viewerRole: string | undefined = 'super_admin',
): Promise<ResourceRow[]> {
  const allowed = allowedVisibilitiesForRole(viewerRole);
  if (allowed.length === 0) return [];
  const lc = tag.trim().toLowerCase();
  if (lc.length === 0) return [];
  const rows = await db
    .select(RESOURCE_SELECT)
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .innerJoin(
      resourceCategories,
      eq(resourceCategories.id, resources.categoryId),
    )
    .where(
      and(
        eq(resources.isPublished, true),
        inArray(resources.visibility, allowed),
        sql`EXISTS (SELECT 1 FROM unnest(${resources.tags}) AS t WHERE lower(t) = ${lc})`,
      ),
    )
    .orderBy(desc(resources.createdAt));
  return rows.map(rowToResource);
}

/** Back-compat: HVA-156-FIX1 read-surface query. Defaults to 'super_admin'
 *  so admin code that did not pass a role keeps working. */
export async function loadPublishedResources(): Promise<ResourceRow[]> {
  return loadPublishedResourcesForRole('super_admin');
}

export async function loadAllResourcesForAdmin(): Promise<ResourceRow[]> {
  const rows = await db
    .select(RESOURCE_SELECT)
    .from(resources)
    .innerJoin(users, eq(users.id, resources.createdByUserId))
    .innerJoin(
      resourceCategories,
      eq(resourceCategories.id, resources.categoryId),
    )
    .orderBy(desc(resources.createdAt));
  return rows.map(rowToResource);
}

// -----------------------------------------------------------------------------
// Announcements — audience-scoped + ack join
// -----------------------------------------------------------------------------

const ANNOUNCEMENT_BASE_SELECT = {
  id: announcements.id,
  categoryId: announcements.categoryId,
  categoryName: announcementCategories.name,
  categorySlug: announcementCategories.slug,
  importance: announcements.importance,
  audience: announcements.audience,
  title: announcements.title,
  body: announcements.body,
  isPublished: announcements.isPublished,
  publishDate: announcements.publishDate,
  publishedAt: announcements.publishedAt,
  createdAt: announcements.createdAt,
  authorName: users.fullName,
};

function rowToAnnouncement(r: {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  importance: string;
  audience: string;
  title: string;
  body: string;
  isPublished: boolean;
  publishDate: string | Date;
  publishedAt: Date;
  createdAt: Date;
  authorName: string | null;
  isAcknowledged: boolean;
  ackCount: number | null;
  ackTotal: number | null;
}): AnnouncementRow {
  const importance = r.importance as AnnouncementImportance;
  const publishDate =
    r.publishDate instanceof Date ? r.publishDate : new Date(r.publishDate);
  return {
    id: r.id,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categorySlug: r.categorySlug,
    importance,
    severity: importance,
    audience: r.audience as AnnouncementAudience,
    title: r.title,
    body: r.body,
    isPublished: r.isPublished,
    publishDate,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    authorName: r.authorName,
    isAcknowledged: r.isAcknowledged,
    isRead: r.isAcknowledged,
    ackCount: r.ackCount,
    ackTotal: r.ackTotal,
  };
}

/**
 * Read-surface query: every published announcement visible to this user
 * (audience match), with publish_date <= today. LEFT JOIN'd to the
 * viewing user's announcement_acknowledgments row so each card knows
 * whether they've explicitly tapped "I've read this".
 */
export async function loadPublishedAnnouncementsForUser(
  userId: string,
  viewerRole: string | undefined,
): Promise<AnnouncementRow[]> {
  const allowed = allowedAudiencesForRole(viewerRole);
  if (allowed.length === 0) return [];
  const rows = await db
    .select({
      ...ANNOUNCEMENT_BASE_SELECT,
      ackedAt: announcementAcknowledgments.acknowledgedAt,
    })
    .from(announcements)
    .innerJoin(users, eq(users.id, announcements.createdByUserId))
    .innerJoin(
      announcementCategories,
      eq(announcementCategories.id, announcements.categoryId),
    )
    .leftJoin(
      announcementAcknowledgments,
      and(
        eq(announcementAcknowledgments.announcementId, announcements.id),
        eq(announcementAcknowledgments.userId, userId),
      ),
    )
    .where(
      and(
        eq(announcements.isPublished, true),
        inArray(announcements.audience, allowed),
        lte(announcements.publishDate, sql`CURRENT_DATE`),
      ),
    )
    .orderBy(desc(announcements.publishDate), desc(announcements.publishedAt));
  return rows.map((r) =>
    rowToAnnouncement({
      ...r,
      isAcknowledged: r.ackedAt !== null,
      ackCount: null,
      ackTotal: null,
    }),
  );
}

/**
 * Admin-surface query: every announcement including unpublished and
 * future-dated. Includes per-announcement ack counts and total intended
 * recipients so the admin list can show "12/26 acknowledged".
 *
 * ackTotal is the count of active users whose role matches the audience
 * — that's the denominator HVA-120 specifies for the rate display.
 */
export async function loadAllAnnouncementsForAdmin(): Promise<
  AnnouncementRow[]
> {
  const rows = await db
    .select({
      ...ANNOUNCEMENT_BASE_SELECT,
      // Count of acks for this announcement (numerator).
      ackCount: sql<number>`(SELECT COUNT(*)::int
        FROM announcement_acknowledgments aa
        WHERE aa.announcement_id = ${announcements.id})`,
      // Total active users whose role can see this announcement (denominator).
      ackTotal: sql<number>`(SELECT COUNT(*)::int
        FROM users u
        WHERE u.is_active = true
          AND CASE ${announcements.audience}
                WHEN 'sales_executive' THEN u.role = 'sales_executive'
                WHEN 'captain' THEN u.role = 'captain'
                WHEN 'both' THEN u.role IN ('sales_executive', 'captain')
              END)`,
    })
    .from(announcements)
    .innerJoin(users, eq(users.id, announcements.createdByUserId))
    .innerJoin(
      announcementCategories,
      eq(announcementCategories.id, announcements.categoryId),
    )
    .orderBy(desc(announcements.publishDate), desc(announcements.publishedAt));
  return rows.map((r) =>
    rowToAnnouncement({
      ...r,
      isAcknowledged: false,
    }),
  );
}

/**
 * Captain "My Team's Acknowledgments" — for each currently-published
 * announcement visible to execs, return its ack rate among the captain's
 * own team (sales_executives.captain_user_id = captain.id).
 *
 * Returns the same AnnouncementRow shape with ackCount/ackTotal scoped
 * to the team.
 */
export async function loadTeamAnnouncementAckRates(
  captainUserId: string,
): Promise<AnnouncementRow[]> {
  const rows = await db
    .select({
      ...ANNOUNCEMENT_BASE_SELECT,
      ackCount: sql<number>`(SELECT COUNT(*)::int
        FROM announcement_acknowledgments aa
        INNER JOIN sales_executives se ON se.user_id = aa.user_id
        WHERE aa.announcement_id = ${announcements.id}
          AND se.captain_user_id = ${captainUserId})`,
      ackTotal: sql<number>`(SELECT COUNT(*)::int
        FROM sales_executives se
        INNER JOIN users u ON u.id = se.user_id
        WHERE se.captain_user_id = ${captainUserId}
          AND u.is_active = true)`,
    })
    .from(announcements)
    .innerJoin(users, eq(users.id, announcements.createdByUserId))
    .innerJoin(
      announcementCategories,
      eq(announcementCategories.id, announcements.categoryId),
    )
    .where(
      and(
        eq(announcements.isPublished, true),
        inArray(announcements.audience, [
          'sales_executive',
          'both',
        ] as AnnouncementAudience[]),
        lte(announcements.publishDate, sql`CURRENT_DATE`),
      ),
    )
    .orderBy(desc(announcements.publishDate));
  return rows.map((r) =>
    rowToAnnouncement({
      ...r,
      isAcknowledged: false,
    }),
  );
}

/** Drives the drawer unread-count badge. Counts published, audience-matching
 *  announcements (publish_date <= today) that the user has not yet
 *  acknowledged. */
export async function countUnreadAnnouncementsForUser(
  userId: string,
  viewerRole: string | undefined,
): Promise<number> {
  const allowed = allowedAudiencesForRole(viewerRole);
  if (allowed.length === 0) return 0;
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(announcements)
    .leftJoin(
      announcementAcknowledgments,
      and(
        eq(announcementAcknowledgments.announcementId, announcements.id),
        eq(announcementAcknowledgments.userId, userId),
      ),
    )
    .where(
      and(
        eq(announcements.isPublished, true),
        inArray(announcements.audience, allowed),
        lte(announcements.publishDate, sql`CURRENT_DATE`),
        isNull(announcementAcknowledgments.userId),
      ),
    );
  return row?.cnt ?? 0;
}
