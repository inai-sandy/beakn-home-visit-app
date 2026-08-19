-- =============================================================================
-- 0091 — order confirmation may only come from CartPlus (HVA-341)
-- =============================================================================
--
-- Sandeep, 2026-08-19, after watching order CP-20260819-IWJHZ0 (Navdeep
-- Sharma) confirm itself in the portal seconds after he confirmed it in
-- CartPlus: "order confirmation should come from CartPlus. After finishing
-- the order, we will disable the button in our portal for order confirmation."
--
-- CartPlus is the system of record for whether an order is real. The portal's
-- manual "Move to Order Confirmed" button let an exec assert it independently,
-- and it was used as often as the webhook (8 manual vs 8 CartPlus to date).
--
-- ---------------------------------------------------------------------------
-- Why a new flag rather than is_active = FALSE
-- ---------------------------------------------------------------------------
--
-- Switching the row off was the obvious move and is wrong twice over:
--
--   1. transitionPermits() in lib/request-detail.ts returns false for an
--      inactive row, so showAdvance goes false and the button VANISHES with
--      no explanation. That is precisely the "it was there before, now it's
--      gone" report HVA-314 was written to stop producing. A locked control
--      must stay visible and say why it is locked.
--
--   2. transitionRequestStatus() checks is_active BEFORE it checks the
--      actor's role, so super_admin would be locked out along with everyone
--      else — no escape hatch on the day a webhook goes missing.
--
-- `system_only` says the thing we actually mean: this stage is reached by the
-- machine, not by a person. The engine keeps its super_admin bypass, so
-- Sandeep retains a manual override and the history row records that he used
-- it.
--
-- The CartPlus webhook is unaffected — applyCartplusOrderStatus writes the
-- stage directly and never consults status_transitions.
-- =============================================================================

ALTER TABLE status_transitions
  ADD COLUMN IF NOT EXISTS system_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN status_transitions.system_only IS
  'Only an integration may take this transition. Humans are refused with SYSTEM_ONLY; super_admin keeps an audited override (HVA-341).';

-- ---------------------------------------------------------------------------
-- The one row: Quotation Given → Order Confirmed
-- ---------------------------------------------------------------------------
--
-- Deliberately scoped to kind='forward'. Two other transitions also land on
-- ORDER_CONFIRMED and must keep working:
--   * INSTALLATION_SCHEDULED → ORDER_CONFIRMED (rollback)
--   * the from=to history rows written by the cancellation paths

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET
  system_only = TRUE,
  description = 'Order confirmation arrives from CartPlus; the portal never asserts it (HVA-341)',
  updated_at  = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'QUOTATION_GIVEN'
  AND ts.code = 'ORDER_CONFIRMED'
  AND st.kind = 'forward';
