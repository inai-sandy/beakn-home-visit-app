-- HVA-303: courier + tracking number per shipment
--
-- Orders ship in installments, so each `dispatches` row is one package and
-- carries its own courier details. Until now support typed these free-hand
-- into `dispatches.notes` (its placeholder literally read "Tracking ID,
-- courier name, comments…"), which meant the exec/captain had nothing
-- reliable to read back and nothing that could ever be searched.
--
-- Deliberately two plain text columns, not a courier registry with tracking
-- URL templates: per Sandeep (2026-08-03) the team just records the courier
-- details and tracks manually on the courier's own site. No dropdown, no
-- generated deep link, no third-party lookup.
--
-- Both nullable — a dispatch can legitimately be recorded before the courier
-- is booked, and the tracking number is often only known at handoff. The
-- existing rows stay valid; no backfill.

ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS courier_name    TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;

-- Support looks a package up by AWB when a customer calls about it.
CREATE INDEX IF NOT EXISTS dispatches_tracking_number_idx
  ON dispatches (tracking_number);

-- Audit allow-list extension (dual-write with lib/config-schema.ts).
--   dispatch_tracking_updated — fires when support fills in or corrects the
--   courier / tracking number after the dispatch row already exists.
UPDATE config
   SET value = (
     SELECT to_jsonb(ARRAY(
       SELECT DISTINCT jsonb_array_elements_text(
         value || jsonb_build_array('dispatch_tracking_updated')
       )
     ))
   ),
       updated_at = NOW()
 WHERE key = 'audit_enabled_events';
