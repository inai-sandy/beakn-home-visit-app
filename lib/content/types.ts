// =============================================================================
// HVA-156 + HVA-156-FIX1: content shared types (DB-runtime-free)
// =============================================================================
//
// Types pulled out of lib/content/queries.ts so client components can
// import them without dragging postgres-js / Drizzle into the browser
// bundle. queries.ts re-exports these for server-side callers.
//
// FIX1 dropped the hardcoded ResourceCategory enum + label table in favour
// of an admin-managed `resource_categories` table; ResourceCategoryRow
// represents a row from that table.
// =============================================================================

export type AnnouncementSeverity = 'info' | 'important' | 'urgent';

/** Row from `resource_categories` — drives the admin CRUD UI + the filter
 *  dropdown on the read surface. */
export interface ResourceCategoryRow {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  title: string;
  url: string;
  description: string | null;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  authorName: string | null;
}

export interface AnnouncementRow {
  id: string;
  severity: AnnouncementSeverity;
  title: string;
  body: string;
  isPublished: boolean;
  publishedAt: Date;
  createdAt: Date;
  authorName: string | null;
  /** True when the viewing user has an announcement_reads row for this id. */
  isRead: boolean;
}
