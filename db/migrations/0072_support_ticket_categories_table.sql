-- =============================================================================
-- HVA-256-FIX1 (HVA-232 follow-up): make ticket categories admin-configurable
-- =============================================================================
--
-- Replace the `support_ticket_category` enum with a `support_ticket_categories`
-- table so admin can add / rename / deactivate categories from
-- /admin/settings/audit-content/ticket-categories without a code change.
--
-- Existing tickets keep their category string verbatim (the enum's string
-- values match the new table's `code` field 1:1 for the 4 seeded rows).
-- The `category` column on support_tickets stays as text/varchar — it
-- holds the category code, not an FK. Soft-reference avoids needing to
-- write a cascade migration if admin ever deletes a category that has
-- historic tickets (we use `is_active=false` instead of DELETE).
--
-- The 'refund' code stays stable so the refund auto-close logic in
-- app/api/requests/[id]/payments/route.ts (which checks
-- `category = 'refund'` literally) continues working. Admin can rename
-- the DISPLAY name ('Refund' → 'Refund Request') without breaking that.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS support_ticket_categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  code          VARCHAR(64) NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_ticket_categories_active_order_idx
  ON support_ticket_categories (is_active, display_order);

-- Seed: 4 default categories matching the existing enum values + display
-- copy. Admin can rename name + reorder; code stays stable.
INSERT INTO support_ticket_categories (code, name, display_order, is_active)
VALUES
  ('complaint', 'Complaint', 10, TRUE),
  ('warranty',  'Warranty',  20, TRUE),
  ('refund',    'Refund',    30, TRUE),
  ('other',     'Other',     40, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Convert support_tickets.category from enum to varchar
-- ---------------------------------------------------------------------------
--
-- ALTER COLUMN ... TYPE with USING preserves existing data; Postgres
-- copies each row's enum text representation into the varchar column.
-- After the conversion the support_ticket_category enum becomes
-- unreferenced and we can drop it cleanly.

ALTER TABLE support_tickets
  ALTER COLUMN category TYPE VARCHAR(64) USING category::text;

DROP TYPE IF EXISTS support_ticket_category;

-- ---------------------------------------------------------------------------
-- 3. Audit allow-list — new admin events for category CRUD
-- ---------------------------------------------------------------------------

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_category_created' THEN value
  ELSE value || '["support_ticket_category_created"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_category_updated' THEN value
  ELSE value || '["support_ticket_category_updated"]'::jsonb
END
WHERE key = 'audit_enabled_events';
