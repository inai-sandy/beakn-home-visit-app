-- =============================================================================
-- HVA-280: quotation_line_items soft-removal
-- =============================================================================
--
-- The CartPlus edit-webhook must drop items a customer removed from their
-- order so the live quotation matches CartPlus exactly. We can't hard
-- delete (no-deletes rule + dispatch_items FK references), so the sync
-- marks `removed_at` instead. A re-added item clears it. All reads of
-- "current" line items filter `removed_at IS NULL`.
-- =============================================================================

ALTER TABLE quotation_line_items
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;
