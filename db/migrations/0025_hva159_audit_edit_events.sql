-- =============================================================================
-- HVA-159: extend audit_enabled_events with the three exec-side edit events
-- =============================================================================
--
-- editContactAction / editRequestAction / editTaskAction all funnel through
-- lib/audit.ts → logEvent. shouldLog() gates writes on the persisted
-- `config.audit_enabled_events` array; this migration appends the three new
-- event types to the running prod row.
--
-- lib/config-schema.ts gets the same defaults so fresh DBs / tests inherit
-- them (dual-write pattern, same as 0022 / 0024).
--
-- No schema changes — audit_log table already has the right shape.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'contact_edited'
    UNION SELECT 'request_edited'
    UNION SELECT 'task_edited'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
