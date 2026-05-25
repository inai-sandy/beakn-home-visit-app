import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
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
// HVA-156 + HVA-156-FIX1 + HVA-156-FIX2: Resources + Announcements
// =============================================================================
//
// Resources: URL bookmarks with admin-managed categories. Each resource
// carries a title, URL, optional description, category FK, visibility
// (all / captains_only / sales_execs_only — HVA-121 spec), and a
// free-form tags[] array for filtering.
//
// Announcements: admin broadcasts with admin-managed categories, audience
// (sales_executive / captain / both), importance (low/medium/high mapped
// to info/important/urgent), publish_date (admin-picked, can be future),
// and explicit per-user acknowledgment via announcement_acknowledgments.
//
// FIX2 renamed the announcement_severity enum to announcement_importance
// per HVA-120 spec wording. The renamed announcement_acknowledgments
// table replaces announcement_reads — same composite-PK shape, but rows
// are now inserted only when a user explicitly taps "I've read this"
// rather than on page-mount.
// =============================================================================

export const announcementImportanceEnum = pgEnum('announcement_importance', [
  'info',
  'important',
  'urgent',
]);

export const announcementAudienceEnum = pgEnum('announcement_audience', [
  'sales_executive',
  'captain',
  'both',
]);

export const resourceVisibilityEnum = pgEnum('resource_visibility', [
  'all',
  'captains_only',
  'sales_execs_only',
]);

// -----------------------------------------------------------------------------
// resource_categories — admin-managed
// -----------------------------------------------------------------------------
export const resourceCategories = pgTable(
  'resource_categories',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(100),
    /** HVA-156-FIX2: admin-controllable explicit ordering (mirrors sort_order
     *  for now; eventually drag-handle UI writes to this column). */
    displayOrder: integer('display_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('resource_categories_name_unique').on(table.name),
    unique('resource_categories_slug_unique').on(table.slug),
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
    url: text('url').notNull(),
    description: varchar('description', { length: 500 }),
    /** HVA-156-FIX2 + HVA-121: visibility scoping. 'all' visible to every
     *  captain + exec; 'captains_only' hides from execs; 'sales_execs_only'
     *  hides from captains. super_admin sees everything via admin surface. */
    visibility: resourceVisibilityEnum('visibility').notNull().default('all'),
    /** HVA-156-FIX2 + HVA-121: free-form tag chips. Used by tag filter on
     *  read surface + by HVA-37 (BHK proposal lookup via tags like '1bhk'). */
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    isPublished: boolean('is_published').notNull().default(true),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    index('resources_published_visibility_category_idx').on(
      table.isPublished,
      table.visibility,
      table.categoryId,
    ),
    index('resources_created_idx').on(table.createdAt),
  ],
);

// -----------------------------------------------------------------------------
// announcement_categories — admin-managed (mirrors resource_categories)
// -----------------------------------------------------------------------------
export const announcementCategories = pgTable(
  'announcement_categories',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    name: varchar('name', { length: 80 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(100),
    displayOrder: integer('display_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('announcement_categories_name_unique').on(table.name),
    unique('announcement_categories_slug_unique').on(table.slug),
    index('announcement_categories_active_sort_idx').on(
      table.isActive,
      table.displayOrder,
      table.name,
    ),
  ],
);

// -----------------------------------------------------------------------------
// announcements — admin broadcasts
// -----------------------------------------------------------------------------
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => announcementCategories.id, { onDelete: 'restrict' }),
    importance: announcementImportanceEnum('importance')
      .notNull()
      .default('info'),
    audience: announcementAudienceEnum('audience').notNull().default('both'),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    isPublished: boolean('is_published').notNull().default(true),
    /** Admin-picked date this announcement becomes visible to its audience.
     *  Future-dated rows are hidden until publish_date <= current_date
     *  (HVA-120 scheduled publishing — no cron yet, the date filter alone
     *  handles "scheduled visibility"). */
    publishDate: date('publish_date').notNull(),
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
    // Read query: WHERE is_published=true AND publish_date <= today
    //   ORDER BY publish_date DESC
    index('announcements_published_date_idx').on(
      table.isPublished,
      table.publishDate.desc(),
    ),
  ],
);

// -----------------------------------------------------------------------------
// announcement_acknowledgments — explicit "I've read this" tap
// -----------------------------------------------------------------------------
//
// Composite-PK so a (user, announcement) pair can exist at most once.
// One-way operation per HVA-120 §13.1 — acks cannot be undone. Admin
// uses this table to compute ack rate per announcement ("12/26 acknowledged").
export const announcementAcknowledgments = pgTable(
  'announcement_acknowledgments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.announcementId] }),
    index('announcement_acknowledgments_user_idx').on(table.userId),
  ],
);

// Back-compat exports (HVA-156-FIX1 used these names; keep them working until
// downstream code migrates).
export const announcementReads = announcementAcknowledgments;
export const announcementSeverityEnum = announcementImportanceEnum;
