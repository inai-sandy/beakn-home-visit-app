-- =============================================================================
-- HVA-156: Resources + Announcements — admin-published content
-- =============================================================================
--
-- Three new tables and two new enums. Resources are editable reference
-- material; Announcements are append-only with a one-line unpublish (no
-- expiry column in v1). announcement_reads is a composite-PK join table
-- that powers the drawer's unread-count badge.
--
-- All FK references to users.id use ON DELETE RESTRICT for the author
-- column (preserve attribution) and ON DELETE CASCADE for announcement_reads
-- (per-user read receipts disappear when the user is hard-deleted, which
-- never happens in production but kept correct for completeness).
-- =============================================================================

CREATE TYPE resource_category AS ENUM (
  'sales_scripts',
  'pricing',
  'brand_assets',
  'training',
  'other'
);

CREATE TYPE announcement_severity AS ENUM (
  'info',
  'important',
  'urgent'
);

CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  category resource_category NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX resources_published_category_idx
  ON resources(is_published, category);

CREATE INDEX resources_created_idx
  ON resources(created_at);

CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  severity announcement_severity NOT NULL DEFAULT 'info',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX announcements_published_at_idx
  ON announcements(is_published, published_at DESC);

CREATE TABLE announcement_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);

-- Powers countUnreadAnnouncements per-user. Composite PK already covers
-- the (user, announcement) lookup; this single-column index covers the
-- "all reads for user" scan independently.
CREATE INDEX announcement_reads_user_idx
  ON announcement_reads(user_id);
