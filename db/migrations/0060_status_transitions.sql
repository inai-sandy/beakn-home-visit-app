-- HVA-223: admin-editable transition rules
--
-- New `status_transitions` table seeded with every transition currently
-- enforced by lib/status-transition.ts. Phase A of the refactor:
--
--   - Table is the source of truth for `requires_datetime` (drives the
--     <AdvanceStatusButton> calendar-picker decision; previously
--     hardcoded to nextStatus.code === 'VISIT_SCHEDULED').
--   - Other columns (kind / allowed_role / requires_reason /
--     requires_quotation / auto_task_type / emits_event / is_active)
--     are read-only DISPLAY in the admin UI for now. Engine enforcement
--     migration is HVA-225.
--
-- UNIQUE on (from_stage_id, to_stage_id) — one row per legal pair.
--
-- Seed mirrors the current hardcoded behavior so deploy is byte-
-- identical until admin starts editing.

CREATE TABLE IF NOT EXISTS status_transitions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  from_stage_id       UUID NOT NULL REFERENCES status_stages(id) ON DELETE RESTRICT,
  to_stage_id         UUID NOT NULL REFERENCES status_stages(id) ON DELETE RESTRICT,
  kind                VARCHAR(32) NOT NULL,
  allowed_role        VARCHAR(32) NOT NULL DEFAULT 'any',
  requires_reason     BOOLEAN     NOT NULL DEFAULT false,
  requires_quotation  BOOLEAN     NOT NULL DEFAULT false,
  requires_datetime   BOOLEAN     NOT NULL DEFAULT false,
  auto_task_type      VARCHAR(64),
  emits_event         VARCHAR(100),
  description         TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS status_transitions_pair_unique
  ON status_transitions (from_stage_id, to_stage_id);

CREATE INDEX IF NOT EXISTS status_transitions_from_idx
  ON status_transitions (from_stage_id);

CREATE INDEX IF NOT EXISTS status_transitions_to_idx
  ON status_transitions (to_stage_id);

-- =============================================================================
-- Seed
-- =============================================================================
--
-- Stage codes (post-migration 0005 seed):
--   1 SUBMITTED                          | 2 ASSIGNED
--   3 VISIT_SCHEDULED                    | 4 VISIT_COMPLETED
--   5 QUOTATION_GIVEN                    | 6 ORDER_CONFIRMED
--   7 INSTALLATION_SCHEDULED             | 8 INSTALLATION_CONFIGURATION_DONE
--   9 PENDING_CAPTAIN_APPROVAL           | 10 ORDER_EXECUTED_SUCCESSFULLY
--
-- The migration uses a CTE that resolves stage UUIDs by code so the
-- seed doesn't depend on insert-order luck.

WITH s AS (
  SELECT code, id FROM status_stages
)
INSERT INTO status_transitions
  (from_stage_id, to_stage_id, kind, allowed_role, requires_reason,
   requires_quotation, requires_datetime, auto_task_type, emits_event,
   description, is_active)
SELECT
  fs.id,                              -- from_stage_id
  ts.id,                              -- to_stage_id
  t.kind,
  t.allowed_role,
  t.requires_reason,
  t.requires_quotation,
  t.requires_datetime,
  t.auto_task_type,
  t.emits_event,
  t.description,
  true
FROM (
  -- Forward +1 (the immediate next stage path)
  VALUES
    ('SUBMITTED', 'ASSIGNED',
     'forward', 'any',  false, false, false, NULL, 'request.assigned',
     'Captain assigns the request to an exec'),
    ('ASSIGNED', 'VISIT_SCHEDULED',
     'forward', 'any',      false, false, true,  'customer_home_visit', 'request.visit_scheduled',
     'Exec picks a date+time; auto-creates a Customer Home Visit task on the exec''s plan'),
    ('VISIT_SCHEDULED', 'VISIT_COMPLETED',
     'forward', 'any',      false, false, false, NULL, NULL,
     'Exec marks the visit done after meeting the customer'),
    ('VISIT_COMPLETED', 'QUOTATION_GIVEN',
     'forward', 'any',      false, false, false, NULL, 'request.quotation_submitted',
     'Exec submits a quotation; customer gets the price WhatsApp'),
    ('QUOTATION_GIVEN', 'ORDER_CONFIRMED',
     'forward', 'any',      false, false, false, NULL, 'request.order_confirmed',
     'Customer confirms the order; customer gets the confirmation WhatsApp'),
    ('ORDER_CONFIRMED', 'INSTALLATION_SCHEDULED',
     'forward', 'any',      false, false, false, NULL, NULL,
     'Exec books an installation slot'),
    ('INSTALLATION_SCHEDULED', 'INSTALLATION_CONFIGURATION_DONE',
     'forward', 'any',      false, false, false, NULL, NULL,
     'Installation team completes the physical install'),
    ('INSTALLATION_CONFIGURATION_DONE', 'PENDING_CAPTAIN_APPROVAL',
     'forward', 'any',      false, false, false, NULL, 'request.pending_approval',
     'Exec hands off to captain for the final approval gate'),
    ('PENDING_CAPTAIN_APPROVAL', 'ORDER_EXECUTED_SUCCESSFULLY',
     'forward', 'any',  false, false, false, NULL, 'request.installation_complete',
     'Captain approves; order is complete; customer gets the completion WhatsApp'),

  -- HVA-68 forward_skip: mark installation complete bypasses
  -- INSTALLATION_CONFIGURATION_DONE
    ('INSTALLATION_SCHEDULED', 'PENDING_CAPTAIN_APPROVAL',
     'forward_skip', 'any', false, false, false, NULL, 'request.pending_approval',
     'Mark Installation Complete shortcut — bundles config-done into one step'),

  -- HVA-141 rollback -1 (single backward step from each non-initial stage)
    ('ASSIGNED', 'SUBMITTED',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo assignment'),
    ('VISIT_SCHEDULED', 'ASSIGNED',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo visit scheduling'),
    ('VISIT_COMPLETED', 'VISIT_SCHEDULED',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo visit completion'),
    ('QUOTATION_GIVEN', 'VISIT_COMPLETED',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo quotation submission'),
    ('ORDER_CONFIRMED', 'QUOTATION_GIVEN',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo order confirmation'),
    ('INSTALLATION_SCHEDULED', 'ORDER_CONFIRMED',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo installation scheduling'),
    ('INSTALLATION_CONFIGURATION_DONE', 'INSTALLATION_SCHEDULED',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo installation completion'),
    ('PENDING_CAPTAIN_APPROVAL', 'INSTALLATION_CONFIGURATION_DONE',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo handoff to captain (captain/admin only)'),
    ('ORDER_EXECUTED_SUCCESSFULLY', 'PENDING_CAPTAIN_APPROVAL',
     'rollback', 'any', false, false, false, NULL, 'status_rolled_back',
     'Undo final approval (captain/admin only)'),

  -- HVA-137 specific_backward: captain rejects pending approval back to
  -- INSTALLATION_SCHEDULED. PENDING_CAPTAIN_APPROVAL → INSTALLATION_SCHEDULED.
    ('PENDING_CAPTAIN_APPROVAL', 'INSTALLATION_SCHEDULED',
     'specific_backward', 'captain', true, false, false, NULL, 'request.rejected_by_captain',
     'Captain rejects the approval and sends back for rework')
) AS t (from_code, to_code, kind, allowed_role, requires_reason, requires_quotation, requires_datetime, auto_task_type, emits_event, description)
JOIN s fs ON fs.code = t.from_code
JOIN s ts ON ts.code = t.to_code
ON CONFLICT (from_stage_id, to_stage_id) DO NOTHING;
