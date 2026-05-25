// =============================================================================
// HVA-156: Resources + Announcements — shared types + label tables
// =============================================================================
//
// Types and label constants pulled out of lib/content/queries.ts so client
// components can import them without dragging the postgres-js / Drizzle
// runtime into the browser bundle (Next.js 16 will otherwise complain
// about the dynamic require in pg-types).
//
// queries.ts re-exports these so server-side callers can keep using the
// `from '@/lib/content/queries'` import path.
// =============================================================================

export const RESOURCE_CATEGORIES = [
  'sales_scripts',
  'pricing',
  'brand_assets',
  'training',
  'other',
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  sales_scripts: 'Sales scripts',
  pricing: 'Pricing',
  brand_assets: 'Brand assets',
  training: 'Training',
  other: 'Other',
};

export type AnnouncementSeverity = 'info' | 'important' | 'urgent';

export interface ResourceRow {
  id: string;
  category: ResourceCategory;
  title: string;
  body: string;
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

export interface ResourcesGroupedByCategory {
  category: ResourceCategory;
  label: string;
  rows: ResourceRow[];
}
