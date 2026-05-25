// =============================================================================
// HVA-156 + HVA-156-FIX1 + HVA-156-FIX2: content shared types
// =============================================================================
//
// Types pulled out of lib/content/queries.ts so client components can
// import them without dragging postgres-js / Drizzle into the browser
// bundle.
// =============================================================================

/** Maps to db enum announcement_importance. Renamed from severity in FIX2. */
export type AnnouncementImportance = 'info' | 'important' | 'urgent';
/** Back-compat alias for HVA-156 callers. */
export type AnnouncementSeverity = AnnouncementImportance;

export type AnnouncementAudience = 'sales_executive' | 'captain' | 'both';

export type ResourceVisibility = 'all' | 'captains_only' | 'sales_execs_only';

export interface ResourceCategoryRow {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementCategoryRow {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  displayOrder: number;
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
  visibility: ResourceVisibility;
  tags: string[];
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  authorName: string | null;
}

export interface AnnouncementRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  importance: AnnouncementImportance;
  /** Back-compat alias for FIX1 read surfaces. */
  severity: AnnouncementImportance;
  audience: AnnouncementAudience;
  title: string;
  body: string;
  isPublished: boolean;
  publishDate: Date;
  publishedAt: Date;
  createdAt: Date;
  authorName: string | null;
  /** True when the viewing user has acknowledged this announcement. */
  isAcknowledged: boolean;
  /** Back-compat alias for FIX1 read surfaces. */
  isRead: boolean;
  /** Per HVA-120: admin sees ack rate; null on user-scoped queries
   *  (loadPublishedAnnouncementsForUser) where the per-user flag is
   *  what matters. Populated on loadAllAnnouncementsForAdmin only. */
  ackCount: number | null;
  ackTotal: number | null;
}
