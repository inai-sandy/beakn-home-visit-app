-- =============================================================================
-- HVA-156-FIX2: Close the gap to HVA-121 + HVA-120 specs
-- =============================================================================
--
-- User option 2C — full spec closure across Resources + Announcements:
--
-- Resources:
--   * resources.visibility enum (all / captains_only / sales_execs_only)
--   * resources.tags text[] (free-form filter tags)
--   * resource_categories.display_order column (admin drag-reorder)
--
-- Announcements:
--   * Rename announcement_severity enum → announcement_importance per
--     Linear spec wording. announcements.severity column renamed to
--     announcements.importance.
--   * announcement_categories table (admin-managed, mirrors resource_categories)
--   * announcements.category_id FK → announcement_categories
--   * announcements.audience enum (sales_executive / captain / both)
--   * announcements.publish_date date (admin-picked, can be future)
--   * announcement_reads renamed to announcement_acknowledgments;
--     read_at column renamed to acknowledged_at — semantic shift per
--     HVA-120: explicit "I've read this" tap, not passive mount-effect.
--
-- All backfills preserve the single demo announcement that exists on prod.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Resource categories — add display_order (admin reorder)
-- -----------------------------------------------------------------------------
ALTER TABLE resource_categories
  ADD COLUMN display_order integer NOT NULL DEFAULT 100;

-- Backfill display_order from sort_order so existing categories keep their
-- relative ordering. Going forward sort_order stays as the SQL column name
-- (Drizzle uses snake_case) but the user-facing label is "display order".
UPDATE resource_categories SET display_order = sort_order;

-- -----------------------------------------------------------------------------
-- 2. Resources — add visibility + tags
-- -----------------------------------------------------------------------------
CREATE TYPE resource_visibility AS ENUM (
  'all',
  'captains_only',
  'sales_execs_only'
);

ALTER TABLE resources
  ADD COLUMN visibility resource_visibility NOT NULL DEFAULT 'all',
  ADD COLUMN tags        text[]              NOT NULL DEFAULT ARRAY[]::text[];

-- Useful for the tag-filter chip group on the read surface — a GIN index
-- on the tags column accelerates `tags && ARRAY[...]` containment checks.
CREATE INDEX resources_tags_gin_idx ON resources USING gin (tags);

-- Replace the (is_published, category_id) index with one that also covers
-- visibility so the read query (the most frequent) can use an index-only
-- scan for the common case "published + matching visibility + category".
DROP INDEX IF EXISTS resources_published_category_idx;
CREATE INDEX resources_published_visibility_category_idx
  ON resources (is_published, visibility, category_id);

-- -----------------------------------------------------------------------------
-- 3. Announcement categories (new admin-managed table)
-- -----------------------------------------------------------------------------
CREATE TABLE announcement_categories (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name         varchar(80) NOT NULL,
  slug         varchar(80) NOT NULL,
  sort_order   integer     NOT NULL DEFAULT 100,
  display_order integer    NOT NULL DEFAULT 100,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_categories_name_unique UNIQUE (name),
  CONSTRAINT announcement_categories_slug_unique UNIQUE (slug)
);

CREATE INDEX announcement_categories_active_sort_idx
  ON announcement_categories (is_active, display_order, name);

-- Seed a starter set so the admin can immediately publish announcements.
-- Admin can rename / reorder / deactivate any of these via
-- /admin/settings/audit-content/announcement-categories.
INSERT INTO announcement_categories (name, slug, sort_order, display_order) VALUES
  ('Operational',         'operational',        10, 10),
  ('Policy',              'policy',             20, 20),
  ('Pricing',             'pricing',            30, 30),
  ('Product',             'product',            40, 40),
  ('Other',               'other',              99, 99);

-- -----------------------------------------------------------------------------
-- 4. Announcements reshape — audience + importance + publish_date + category
-- -----------------------------------------------------------------------------

-- 4a. Rename severity enum + column to importance (matches HVA-120 spec).
ALTER TYPE announcement_severity RENAME TO announcement_importance;
ALTER TABLE announcements RENAME COLUMN severity TO importance;

-- 4b. Audience enum + column. Default 'both' so existing rows are visible
-- to everyone (matches the broadcast behaviour we shipped originally).
CREATE TYPE announcement_audience AS ENUM (
  'sales_executive',
  'captain',
  'both'
);

ALTER TABLE announcements
  ADD COLUMN audience     announcement_audience NOT NULL DEFAULT 'both',
  ADD COLUMN publish_date date,
  ADD COLUMN category_id  uuid;

-- 4c. Backfill publish_date from published_at (the only known publish time
-- so far is when the row was inserted).
UPDATE announcements SET publish_date = published_at::date;

-- 4d. Backfill category_id by mapping every existing announcement to the
-- 'Other' category. Admin can recategorise via the edit modal afterwards.
UPDATE announcements a
SET category_id = c.id
FROM announcement_categories c
WHERE c.slug = 'other'
  AND a.category_id IS NULL;

-- 4e. Flip both new columns NOT NULL now that backfill is complete.
ALTER TABLE announcements
  ALTER COLUMN publish_date SET NOT NULL,
  ALTER COLUMN category_id  SET NOT NULL,
  ADD CONSTRAINT announcements_category_fk
    FOREIGN KEY (category_id) REFERENCES announcement_categories(id)
    ON DELETE RESTRICT;

-- 4f. Read query needs (is_published, publish_date DESC) — replace the
-- old (is_published, published_at DESC) index since publish_date is the
-- new "when is this visible" anchor.
DROP INDEX IF EXISTS announcements_published_at_idx;
CREATE INDEX announcements_published_date_idx
  ON announcements (is_published, publish_date DESC);

-- -----------------------------------------------------------------------------
-- 5. Rename announcement_reads → announcement_acknowledgments
-- -----------------------------------------------------------------------------
--
-- Semantic shift per HVA-120: rows are inserted only when a user explicitly
-- taps "I've read this" — not as a passive mount-effect. The composite
-- primary key still enforces one ack per (user, announcement).
ALTER TABLE announcement_reads RENAME TO announcement_acknowledgments;
ALTER TABLE announcement_acknowledgments RENAME COLUMN read_at TO acknowledged_at;
ALTER INDEX announcement_reads_user_idx
  RENAME TO announcement_acknowledgments_user_idx;
ALTER TABLE announcement_acknowledgments
  RENAME CONSTRAINT announcement_reads_pkey
  TO announcement_acknowledgments_pkey;
