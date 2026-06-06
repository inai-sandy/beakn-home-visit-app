-- HVA-235 (HVA-231 Phase 1.1): dispatch schema + support role
--
-- Three new tables for the support team's dispatch workflow:
--   dispatches              — one row per dispatch event (a package leaving for the customer)
--   dispatch_items          — junction: which line items + how much of each landed in this dispatch
--   dispatch_status_history — lifecycle audit per dispatch event (created → packed → handed_off)
--
-- Plus extends user_role enum with 'support'.
--
-- Multi-order dispatch: a single dispatches row CAN include items from
-- multiple visit_requests via the items junction. No request_id on
-- dispatches itself — the relationship to orders is derived through
-- dispatch_items → quotation_line_items → quotations → visit_requests.

-- 1. Extend user_role enum with 'support'.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'support';

-- 2. Dispatch lifecycle stage enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_stage') THEN
    CREATE TYPE dispatch_stage AS ENUM ('created', 'packed', 'handed_off');
  END IF;
END$$;

-- 3. dispatches: one row per dispatch event.
--    No FK to a single request — multi-order dispatches link to many
--    orders via the items junction. Attribution = dispatched_by_user_id.
CREATE TABLE IF NOT EXISTS dispatches (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  dispatched_by_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dispatches_dispatched_by_idx
  ON dispatches (dispatched_by_user_id);
CREATE INDEX IF NOT EXISTS dispatches_created_at_idx
  ON dispatches (created_at DESC);

-- 4. dispatch_items: junction between a dispatch event and one or more
--    line items, each carrying a quantity. Partial dispatch = qty < line
--    item total; multiple dispatch_items rows for the same line_item
--    across different dispatches = staged shipments.
--
--    UNIQUE per (dispatch_id, quotation_line_item_id) prevents the
--    same item from being listed twice in one dispatch event (would be
--    ambiguous when summing).
--
--    quotation_line_item_id is RESTRICT — once an item has been
--    dispatched, deleting/reparenting that line item is blocked (audit
--    integrity). dispatch_id is CASCADE — if the parent dispatch is
--    ever hard-deleted (unlikely; we don't delete in HVA), items follow.
CREATE TABLE IF NOT EXISTS dispatch_items (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  dispatch_id              UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  quotation_line_item_id   UUID NOT NULL REFERENCES quotation_line_items(id) ON DELETE RESTRICT,
  qty_in_this_dispatch     INTEGER NOT NULL CHECK (qty_in_this_dispatch > 0),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_items_dispatch_lineitem_unique
  ON dispatch_items (dispatch_id, quotation_line_item_id);
CREATE INDEX IF NOT EXISTS dispatch_items_dispatch_idx
  ON dispatch_items (dispatch_id);
CREATE INDEX IF NOT EXISTS dispatch_items_lineitem_idx
  ON dispatch_items (quotation_line_item_id);

-- 5. dispatch_status_history: lifecycle audit per dispatch. Each
--    transition is a row. UNIQUE per (dispatch_id, stage) since a
--    dispatch should hit each stage at most once.
CREATE TABLE IF NOT EXISTS dispatch_status_history (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  dispatch_id              UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  stage                    dispatch_stage NOT NULL,
  changed_by_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_status_history_dispatch_stage_unique
  ON dispatch_status_history (dispatch_id, stage);
CREATE INDEX IF NOT EXISTS dispatch_status_history_dispatch_idx
  ON dispatch_status_history (dispatch_id, changed_at);

-- 6. Audit allow-list extension (dual-write with lib/config-schema.ts).
--    dispatch_created   — fires when support inserts a new dispatch row
--    dispatch_advanced  — fires on each stage transition (packed, handed_off)
--    dispatch_item_added — fires per item added to a dispatch
UPDATE config
   SET value = (
     SELECT to_jsonb(ARRAY(
       SELECT DISTINCT jsonb_array_elements_text(
         value || jsonb_build_array(
           'dispatch_created',
           'dispatch_advanced',
           'dispatch_item_added'
         )
       )
     ))
   ),
       updated_at = NOW()
 WHERE key = 'audit_enabled_events';
