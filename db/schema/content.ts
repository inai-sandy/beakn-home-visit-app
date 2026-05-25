import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';

// =============================================================================
// HVA-156 + HVA-156-FIX1: Resources + Announcements — admin-published content
// =============================================================================
//
// Two surfaces, one source of truth, broadcast to all staff (every exec +
// every captain reads the same rows). super_admin authors.
//
// Resources (HVA-156-FIX1 rework): URL bookmarks with admin-managed
// categories. Each resource carries a title, a URL (Google Drive / Dropbox /
// Notion / etc.), an optional short description, and a category FK. The
// read surface filters by category + text search and exposes Download
// (opens URL) + Share (Web Share API) per row.
//
// Categories live in `resource_categories` so super_admin can add /
// rename / reorder / deactivate them at runtime. No deletes — toggling
// `is_active = false` removes the category from filter dropdowns while
// preserving FK references on existing resources.
//
// Announcements: append-only historical record. No edit; super_admin can
// only unpublish via the is_published flag.
//
// Read-tracking: announcement_reads composite-PK join table powers the
// unread-count badge on the drawer. (resources have no read state.)
// =============================================================================

// announcement_severity stays as a hardcoded enum: severity is a fixed
// 3-level UX classification, not a runtime knob.
export const announcementSeverityEnum = pgEnum('announcement_severity', [
  'info',
  'important',
  'urgent',
]);

// -----------------------------------------------------------------------------
// resource_categories — admin-managed filter list
// -----------------------------------------------------------------------------
export const resourceCategories = pgTable(
  'resource_categories',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('resource_categories_name_unique').on(table.name),
    unique('resource_categories_slug_unique').on(table.slug),
    // Filter dropdown query: WHERE is_active=true ORDER BY sort_order, name.
    index('resource_categories_active_sort_idx').on(
      table.isActive,
      table.sortOrder,
      table.name,
    ),
  ],
);

// -----------------------------------------------------------------------------
// resources — URL bookmarks
// -----------------------------------------------------------------------------
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => resourceCategories.id, { onDelete: 'restrict' }),
    title: varchar('title', { length: 200 }).notNull(),
    // Required. Validated as a URL by Zod at the action boundary; the DB
    // accepts any text so failing URLs don't 500 here (the read surface
    // shows whatever was saved).
    url: text('url').notNull(),
    description: varchar('description', { length: 500 }),
    isPublished: boolean('is_published').notNull().default(true),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    // Read query: WHERE is_published=true (+ optional category_id filter).
    index('resources_published_category_idx').on(
      table.isPublished,
      table.categoryId,
    ),
    index('resources_created_idx').on(table.createdAt),
  ],
);

// -----------------------------------------------------------------------------
// announcements — admin broadcasts (unchanged from HVA-156)
// -----------------------------------------------------------------------------
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    severity: announcementSeverityEnum('severity').notNull().default('info'),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    isPublished: boolean('is_published').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('announcements_published_at_idx').on(
      table.isPublished,
      table.publishedAt.desc(),
    ),
  ],
);

// Composite-PK so a (user, announcement) pair can exist at most once —
// ON CONFLICT DO NOTHING makes mark-read idempotent without app-side
// dedup.
export const announcementReads = pgTable(
  'announcement_reads',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.announcementId] }),
    // Drives countUnreadAnnouncements — per-user lookup.
    index('announcement_reads_user_idx').on(table.userId),
  ],
);
