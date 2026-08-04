-- =============================================================================
-- 0086 — installation gets a real date (HVA-317)
-- =============================================================================
--
-- The last "no stop" in Sandeep's flow. Today ORDER_CONFIRMED →
-- INSTALLATION_SCHEDULED is a one-tap advance that schedules nothing:
--
--   * requires_datetime = false, so no date picker ever appears;
--   * there is no column to store an installation date — only
--     visit_requests.visit_scheduled_at exists;
--   * auto_task_type = 'installation' has been set since migration 0070, but
--     it is consumed ONLY by the date-picker path in
--     lib/visit-schedule/actions.ts, so the "Installation & Activation" task
--     that migration promised has never once been created.
--
-- Flipping requires_datetime alone would not have worked: the picked date had
-- nowhere to be stored. Hence the column, and hence making the write
-- data-driven rather than adding a second hardcoded stage check.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

ALTER TABLE visit_requests
  ADD COLUMN IF NOT EXISTS installation_scheduled_at TIMESTAMPTZ;

COMMENT ON COLUMN visit_requests.installation_scheduled_at IS
  'When the installation is planned. Set by the date picker on ORDER_CONFIRMED → INSTALLATION_SCHEDULED (HVA-317). Distinct from visit_scheduled_at, which is the home visit.';

CREATE INDEX IF NOT EXISTS visit_requests_installation_scheduled_idx
  ON visit_requests (installation_scheduled_at);

-- ---------------------------------------------------------------------------
-- 2. Make "which datetime column does this transition write?" data, not code
-- ---------------------------------------------------------------------------
--
-- lib/visit-schedule/actions.ts decided this with a hardcoded string compare:
--
--     const writesVisitScheduledAt = transitionRow.toStageCode === 'VISIT_SCHEDULED';
--
-- which is the same shape of hardcoding HVA-310 removed from the UI: a rule
-- the config was supposed to own, duplicated in code. A third scheduled thing
-- (a service call, a revisit) would have meant a third branch.
--
-- NULL means "this transition schedules nothing", which is every row except
-- the two below.

ALTER TABLE status_transitions
  ADD COLUMN IF NOT EXISTS writes_datetime_column VARCHAR(64);

COMMENT ON COLUMN status_transitions.writes_datetime_column IS
  'visit_requests column the picked datetime is written to, or NULL when the transition schedules nothing. Code-controlled: only values the schedule action allow-lists are honoured (HVA-317).';

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET writes_datetime_column = 'visit_scheduled_at',
    updated_at             = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'ASSIGNED'
  AND ts.code = 'VISIT_SCHEDULED';

-- ---------------------------------------------------------------------------
-- 3. Turn the installation picker on
-- ---------------------------------------------------------------------------
--
-- auto_task_type='installation' and emits_event='request.installation_scheduled'
-- were already set by 0070. With requires_datetime on and a column to write
-- to, that wiring finally does something: the exec picks a date, it is stored,
-- and the Installation & Activation task lands on their day plan.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET requires_datetime      = TRUE,
    writes_datetime_column = 'installation_scheduled_at',
    description            = 'Exec picks the installation date; customer is notified (HVA-317)',
    updated_at             = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'ORDER_CONFIRMED'
  AND ts.code = 'INSTALLATION_SCHEDULED'
  AND st.kind = 'forward';
