-- =============================================================================
-- HVA-156-FIX1: Rework Resources around URL bookmarks + admin-managed categories
-- =============================================================================
--
-- Walk-bug feedback from 2026-05-25: Resources as a "title + body" form is
-- the wrong abstraction. Field reality is that resources are URL bookmarks
-- (Google Drive / Dropbox / Notion links) that sales execs hand off to
-- customers via WhatsApp. The shipped UI has no real benefit over a
-- shared Notion page.
--
-- Decisions (locked with user before this migration):
--   D1  resources gain a `url` text NOT NULL field; `body` becomes
--       `description` (text NULL, capped 500 chars)
--   D2  Categories move from a hardcoded enum to a `resource_categories`
--       admin-managed table (name + sort_order + is_active). Single
--       category per resource (FK).
--   D3  Read surface = category dropdown + text search, flat list
--       (the old grouped-accordion query is replaced)
--   D4  Share = Web Share API + copy-link fallback (client-side; no schema)
--
-- Migration of existing data:
--   - One resource row exists on prod ("This is a demo"). Its category
--     was 'sales_scripts' (old enum). We seed the 5 default categories
--     and remap the demo row to the 'Sales scripts' category via the
--     slug-keyed lookup; body is copied verbatim into description; url
--     defaults to empty string (admin will edit before re-publishing).
--   - resource_category enum is dropped (no other consumers).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. resource_categories — admin-managed (no deletes; deactivate via is_active)
-- -----------------------------------------------------------------------------
CREATE TABLE resource_categories (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name         varchar(80)  NOT NULL,
  slug         varchar(80)  NOT NULL,
  sort_order   integer      NOT NULL DEFAULT 100,
  is_active    boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT resource_categories_name_unique UNIQUE (name),
  CONSTRAINT resource_categories_slug_unique UNIQUE (slug)
);

CREATE INDEX resource_categories_active_sort_idx
  ON resource_categories (is_active, sort_order, name);

-- Seed 5 starter categories mirroring the deprecated enum labels. Admin
-- can rename, reorder, or deactivate any of these via /admin/content/categories.
INSERT INTO resource_categories (name, slug, sort_order) VALUES
  ('Sales scripts', 'sales-scripts',   10),
  ('Pricing',       'pricing',         20),
  ('Brand assets',  'brand-assets',    30),
  ('Training',      'training',        40),
  ('Other',         'other',           99);

-- -----------------------------------------------------------------------------
-- 2. resources — reshape: add category_id FK, add url, rename body
-- -----------------------------------------------------------------------------

-- 2a. Add category_id (nullable for backfill window).
ALTER TABLE resources
  ADD COLUMN category_id uuid REFERENCES resource_categories(id) ON DELETE RESTRICT;

-- 2b. Backfill category_id from the deprecated enum column. Mapping mirrors
-- the seed above. Any unmapped category (none expected, but defensive)
-- defaults to the "Other" category so the NOT NULL flip in 2d doesn't blow up.
UPDATE resources r
SET category_id = rc.id
FROM resource_categories rc
WHERE rc.slug = CASE r.category
  WHEN 'sales_scripts' THEN 'sales-scripts'
  WHEN 'pricing'       THEN 'pricing'
  WHEN 'brand_assets'  THEN 'brand-assets'
  WHEN 'training'      THEN 'training'
  ELSE 'other'
END;

-- 2c. Add url + description. url defaults to empty string for any existing
-- rows; admin must fill it before the next publish.
ALTER TABLE resources
  ADD COLUMN url         text NOT NULL DEFAULT '',
  ADD COLUMN description varchar(500);

-- 2d. Backfill description from the deprecated body column. Truncate to
-- 500 chars; if the demo row's body is longer the prefix is kept.
UPDATE resources
SET description = LEFT(body, 500);

-- 2e. Flip category_id NOT NULL now that backfill is complete.
ALTER TABLE resources
  ALTER COLUMN category_id SET NOT NULL;

-- 2f. Drop the deprecated body + category columns and the now-orphaned enum.
ALTER TABLE resources DROP COLUMN body;
ALTER TABLE resources DROP COLUMN category;
DROP TYPE resource_category;

-- 2g. Drop the old (is_published, category) index — category is gone — and
-- create the replacement (is_published, category_id) index for the new
-- read query. IF EXISTS keeps this safe on any testcontainer that may
-- already have a partial state from a prior aborted migration.
DROP INDEX IF EXISTS resources_published_category_idx;
CREATE INDEX resources_published_category_idx
  ON resources (is_published, category_id);

-- 2h. Drop the empty-string default on url. New inserts must supply a
-- value (the application's Zod validator enforces this); leftover
-- empty-string rows from the demo period remain as-is until admin edits.
ALTER TABLE resources ALTER COLUMN url DROP DEFAULT;
