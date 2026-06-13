-- =============================================================================
-- HVA-281: request target value (vs CartPlus actual quotation)
-- =============================================================================
--
-- Sandeep 2026-06-13: the exec's number on a Beakn request is a TARGET (a
-- goal). The ACTUAL quotation (value + line items) is owned by CartPlus.
-- Finance counts CartPlus actuals only.
--
--   1. visit_requests.target_value_paise — the exec-entered target, paise
--      bigint per the money-integer rule, nullable (optional on every
--      request).
--
--   2. Backfill: existing MANUAL quotations were really targets all along
--      (Sandeep confirmed historic data is test-only). Copy each manual
--      quotation's total into its request's target so nothing visible is
--      lost. Portal quotations (the real actuals) are untouched. The
--      manual quotation rows are NOT deleted (no-deletes rule); finance
--      now gates on source='portal' so they stop counting.
-- =============================================================================

ALTER TABLE visit_requests
  ADD COLUMN IF NOT EXISTS target_value_paise bigint;

UPDATE visit_requests vr
SET target_value_paise = q.total_order_value_paise
FROM quotations q
WHERE q.visit_request_id = vr.id
  AND q.source = 'manual'
  AND vr.target_value_paise IS NULL;
