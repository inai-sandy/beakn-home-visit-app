-- HVA-234 (HVA-231 Phase 1.0): line items model + quotations extensions
--
-- Adds per-item structure to quotations. Shared foundation for HVA-231
-- (support team dispatch) AND HVA-230 (ECOM webhook auto-create). Without
-- per-item rows, support can't dispatch items + webhook has nowhere to
-- store the portal's line items.
--
-- Additive only — no destructive changes. Existing manual quotations
-- (just total + notes) keep working; source='manual' default.

-- 1. Quotation source enum + line item priority enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quotation_source') THEN
    CREATE TYPE quotation_source AS ENUM ('manual', 'portal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'line_item_priority') THEN
    CREATE TYPE line_item_priority AS ENUM ('low', 'med', 'high');
  END IF;
END$$;

-- 2. Extend quotations table.
--    source defaults to 'manual' so existing rows stay valid.
--    portal_quotation_id is the external order_id (UNIQUE when set —
--    webhook idempotency dedupes revisions of the same portal order).
--    raw_payload + last_webhook_at are populated only when source='portal'.
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS source quotation_source NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS portal_quotation_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;

-- Partial UNIQUE index so only rows with portal_quotation_id set are
-- constrained — manual quotations leave it NULL and don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS quotations_portal_quotation_id_unique
  ON quotations (portal_quotation_id)
  WHERE portal_quotation_id IS NOT NULL;

-- 3. New quotation_line_items table.
--    1:N with quotations. ON DELETE CASCADE because items have no
--    independent identity from their parent quotation. Position column
--    preserves display order regardless of insert sequence.
CREATE TABLE IF NOT EXISTS quotation_line_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  quotation_id          UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position              INTEGER NOT NULL,
  product_name          VARCHAR(255) NOT NULL,
  product_sku           VARCHAR(128),
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise      BIGINT  NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise      BIGINT  NOT NULL CHECK (line_total_paise >= 0),
  gst_percent           NUMERIC(5,2),
  notes                 TEXT,
  priority              line_item_priority NOT NULL DEFAULT 'med',
  target_dispatch_date  DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by quotation (the dominant query — show all items for an order).
CREATE INDEX IF NOT EXISTS quotation_line_items_quotation_idx
  ON quotation_line_items (quotation_id);

-- Support queue sort: priority DESC then earliest target date first.
CREATE INDEX IF NOT EXISTS quotation_line_items_priority_target_idx
  ON quotation_line_items (priority, target_dispatch_date);

-- SKU-grouped reporting ("how many of SKU X this month?").
CREATE INDEX IF NOT EXISTS quotation_line_items_sku_idx
  ON quotation_line_items (product_sku)
  WHERE product_sku IS NOT NULL;

-- 4. Add the three new audit event types to the allow-list. CLAUDE.md
--    dual-write pattern: lib/config-schema.ts defaults already include
--    these; this UPDATE merges them into the live config row so audit
--    emissions land starting on the deploy that includes this migration.
UPDATE config
   SET value = (
     SELECT to_jsonb(ARRAY(
       SELECT DISTINCT jsonb_array_elements_text(
         value || jsonb_build_array(
           'line_item_added',
           'line_item_updated',
           'line_item_priority_changed'
         )
       )
     ))
   ),
       updated_at = NOW()
 WHERE key = 'audit_enabled_events';
