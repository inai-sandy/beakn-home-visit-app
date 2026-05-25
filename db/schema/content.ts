import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';

// =============================================================================
// HVA-156: Resources + Announcements — admin-published content
// =============================================================================
//
// Two surfaces, one source of truth, broadcast to all staff (every exec +
// every captain reads the same rows). super_admin authors. Captain
// authorship is intentionally not in v1 (D2).
//
// Resources: editable reference material (sales scripts, pricing, brand
// assets, training, other). Edit permitted because typos and pricing
// updates are the whole point.
//
// Announcements: append-only historical record. No edit; super_admin can
// only unpublish via the is_published flag (no expiry column in v1 per
// D10).
//
// Read-tracking: announcement_reads composite-PK join table powers the
// unread-count badge on the drawer. (resources have no read state — they
// are reference material, not a feed.)
// =============================================================================

export const resourceCategoryEnum = pgEnum('resource_category', [
  'sales_scripts',
  'pricing',
  'brand_assets',
  'training',
  'other',
]);

export const announcementSeverityEnum = pgEnum('announcement_severity', [
  'info',
  'important',
  'urgent',
]);

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    category: resourceCategoryEnum('category').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    isPublished: boolean('is_published').notNull().default(true),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (table) => [
    // Drives the read surface — filter on is_published, group by category.
    index('resources_published_category_idx').on(
      table.isPublished,
      table.category,
    ),
    index('resources_created_idx').on(table.createdAt),
  ],
);

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
    // The read query: WHERE is_published=true ORDER BY published_at DESC.
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
