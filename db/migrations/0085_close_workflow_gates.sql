-- =============================================================================
-- 0085 — close the workflow gates (HVA-313 + HVA-314)
-- =============================================================================
--
-- Sandeep walked /requests/019ec703-… on 2026-08-04 and reported: "I clicked
-- on the status, and every next status popped up, and it's continuous, no
-- stop, nothing."
--
-- He was right. HVA-310 made the request-detail UI *obey* status_transitions,
-- but every gate in the table was still switched off — allowed_role='any'
-- everywhere, requires_quotation=false, the forward_skip shortcut active. A
-- UI that faithfully obeys a config permitting everything looks exactly like
-- one that ignores the config. The request he walked proves it: it sat at
-- ORDER_CONFIRMED with ZERO quotation rows.
--
-- This migration turns the rules on. Every clause below is enforced by
-- lib/status-transition.ts already; none of it is new engine behaviour.
--
-- No DDL is needed for allowed_role — it is a bare varchar(32), the admin UI
-- at /admin/settings/workflow/transitions already offers 'super_admin', and
-- the engine's `actorRole !== SUPER_ADMIN` bypass gives exactly the intended
-- semantics ("super_admin only"). The CHECK at the end is added so a typo
-- can no longer silently lock a transition to super_admin-only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- HVA-314 — Quotation Given may only come from CartPlus
-- ---------------------------------------------------------------------------
--
-- Locked decisions 2 + 10. Quotations are raised and revised in CartPlus; the
-- portal must never mint one. The engine's QUOTATION_REQUIRED branch
-- (lib/status-transition.ts) has always enforced this — it was simply off.
--
-- The CartPlus webhook is unaffected: handler-order-created.ts writes the
-- quotation row inside the same transaction as the stage advance, so the
-- check passes for the only path that is supposed to reach this stage.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET
  requires_quotation = TRUE,
  description        = 'Quotation must arrive from CartPlus — the portal never mints one (HVA-314)',
  updated_at         = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'VISIT_COMPLETED'
  AND ts.code = 'QUOTATION_GIVEN';

-- ---------------------------------------------------------------------------
-- HVA-313 (a) — Order Confirmed is a one-way door
-- ---------------------------------------------------------------------------
--
-- Locked decision 16. Once CartPlus confirms an order it locks it; the portal
-- must match. super_admin keeps an escape hatch, but must give a reason so
-- the reversal is on the record.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET
  allowed_role    = 'super_admin',
  requires_reason = TRUE,
  description     = 'Undo order confirmation — super_admin only, reason required (HVA-313)',
  updated_at      = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'ORDER_CONFIRMED'
  AND ts.code = 'QUOTATION_GIVEN'
  AND st.kind = 'rollback';

-- ---------------------------------------------------------------------------
-- HVA-313 (b) — Captain Approval is a one-way door
-- ---------------------------------------------------------------------------
--
-- Locked decision 17. Reject-to-installation stays the only backward path
-- from this stage and remains captain-only with a mandatory reason (seeded in
-- 0060, untouched here).
--
-- Note this row's own description already said "captain/admin only" while its
-- allowed_role said 'any' — the config contradicted itself. Fixed.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET
  allowed_role    = 'super_admin',
  requires_reason = TRUE,
  description     = 'Undo handoff to captain — super_admin only, reason required (HVA-313)',
  updated_at      = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'PENDING_CAPTAIN_APPROVAL'
  AND ts.code = 'INSTALLATION_CONFIGURATION_DONE'
  AND st.kind = 'rollback';

-- ---------------------------------------------------------------------------
-- HVA-313 (c) — installation must be explicitly finished
-- ---------------------------------------------------------------------------
--
-- Locked decision 21. The HVA-68 forward_skip let an exec jump from
-- Installation Scheduled straight to Captain Approval, skipping "installation
-- finished" entirely — so a captain could be asked to approve work nobody had
-- marked as done.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET
  is_active   = FALSE,
  description = 'Disabled (HVA-313) — installation must be marked finished first',
  updated_at  = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'INSTALLATION_SCHEDULED'
  AND ts.code = 'PENDING_CAPTAIN_APPROVAL'
  AND st.kind = 'forward_skip';

-- ---------------------------------------------------------------------------
-- HVA-313 (d) — stop the terminal rollback row from lying
-- ---------------------------------------------------------------------------
--
-- ORDER_EXECUTED_SUCCESSFULLY → PENDING_CAPTAIN_APPROVAL is is_active=TRUE but
-- unreachable: the engine's TERMINAL_STAGE guard fires before the transition
-- lookup, and computeActionVisibility returns all-false at a terminal stage.
-- Locked decision 3 says no rollback is wanted there, so deactivate it rather
-- than leave config that claims a capability the system does not have.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET
  is_active   = FALSE,
  description = 'Disabled (HVA-313) — terminal stage; the engine blocks this before the table is consulted',
  updated_at  = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'ORDER_EXECUTED_SUCCESSFULLY'
  AND ts.code = 'PENDING_CAPTAIN_APPROVAL'
  AND st.kind = 'rollback';

-- ---------------------------------------------------------------------------
-- HVA-313 (e) — constrain allowed_role
-- ---------------------------------------------------------------------------
--
-- allowed_role has been a free varchar(32) since 0060. A typo ('captian')
-- matches no actor role, so the transition silently becomes super_admin-only
-- via the engine's bypass — a lockout that looks like a permissions bug.
--
-- 'support' is included: it is a real value in lib/auth/roles.ts USER_ROLES
-- even though the admin dropdown does not offer it yet, and the constraint
-- should not be the thing that blocks a future support-scoped transition.

ALTER TABLE status_transitions
  DROP CONSTRAINT IF EXISTS status_transitions_allowed_role_check;

ALTER TABLE status_transitions
  ADD CONSTRAINT status_transitions_allowed_role_check
  CHECK (allowed_role IN ('any', 'sales_executive', 'captain', 'super_admin', 'support'));
