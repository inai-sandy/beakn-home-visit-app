-- =============================================================================
-- HVA-253 (lifts the HVA-226 placeholder): generalised calendar / auto-task
-- =============================================================================
--
-- Wires the ORDER_CONFIRMED → INSTALLATION_SCHEDULED transition end-to-end
-- so admins can flip its `requires_datetime` toggle and have it actually
-- do useful work:
--
--   - auto_task_type = 'installation' — when an exec advances to INSTALLATION_
--     SCHEDULED via the calendar dialog, an Installation & Activation task
--     auto-lands on their plan for the picked date
--   - emits_event = 'request.installation_scheduled' — notification engine
--     pings exec + captain + super_admin
--
-- The actual code generalisation (decoupling the schedule action from
-- VISIT_SCHEDULED) lives in lib/visit-schedule/actions.ts in the same PR.
--
-- Idempotent — UPDATE uses a WHERE that no-ops if the transition row
-- has already been changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Wire INSTALLATION_SCHEDULED into the calendar plumbing
-- ---------------------------------------------------------------------------

WITH s AS (
  SELECT code, id FROM status_stages
)
UPDATE status_transitions st
SET
  auto_task_type = 'installation',
  emits_event    = 'request.installation_scheduled',
  updated_at     = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'ORDER_CONFIRMED'
  AND ts.code = 'INSTALLATION_SCHEDULED'
  AND st.kind = 'forward';

-- ---------------------------------------------------------------------------
-- 1b. Pre-existing event-name mismatch: fix
-- ---------------------------------------------------------------------------
--
-- HVA-46 (migration 0052) seeded notification_rules for event 'request.scheduled'.
-- HVA-223 (migration 0060) seeded status_transitions.emits_event for the
-- ASSIGNED → VISIT_SCHEDULED row as 'request.visit_scheduled' — a different
-- string. The legacy scheduleVisitAction hardcoded 'request.scheduled' so
-- the discrepancy was masked.
--
-- HVA-253 generalises the action to read emits_event from the transition
-- row. Aligning the column to match the notification_rules row prevents
-- a silent regression on customer WhatsApp delivery for visit scheduling.

WITH s AS (
  SELECT code, id FROM status_stages
)
UPDATE status_transitions st
SET
  emits_event = 'request.scheduled',
  updated_at  = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'ASSIGNED'
  AND ts.code = 'VISIT_SCHEDULED'
  AND st.kind = 'forward'
  AND st.emits_event = 'request.visit_scheduled';

-- ---------------------------------------------------------------------------
-- 2. Notification rules for the new event
-- ---------------------------------------------------------------------------
--
-- in_app + push to exec_assigned + captain_owning_city + super_admin.
-- WhatsApp deferred — needs a new Meta-approved template (separate ticket).

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.installation_scheduled', 'in_app', 'exec_assigned',       TRUE,  NULL),
  ('request.installation_scheduled', 'in_app', 'captain_owning_city', TRUE,  NULL),
  ('request.installation_scheduled', 'in_app', 'super_admin',         TRUE,  NULL),
  ('request.installation_scheduled', 'push',   'exec_assigned',       TRUE,  NULL),
  ('request.installation_scheduled', 'push',   'captain_owning_city', TRUE,  NULL),
  ('request.installation_scheduled', 'push',   'super_admin',         TRUE,  NULL)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Audit allow-list — let the new event be auditable
-- ---------------------------------------------------------------------------
--
-- Dual-write per HVA-240 retrospective: migration appends + lib/config-schema.ts
-- defaults updated in the same PR.

UPDATE config
SET value = CASE
  WHEN value ? 'request.installation_scheduled' THEN value
  ELSE value || '["request.installation_scheduled"]'::jsonb
END
WHERE key = 'audit_enabled_events';
