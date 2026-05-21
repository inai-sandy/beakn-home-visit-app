-- =============================================================================
-- HVA-169: extend audit_enabled_events with task_rolled_over
-- =============================================================================
--
-- rollOverPendingTasks() (cron-fired daily at 21:31 IST) writes one
-- audit_log row per task it flips. shouldLog() in lib/audit.ts gates writes
-- on the persisted `config.audit_enabled_events` array; this migration
-- appends the new event type to the running prod row.
--
-- lib/config-schema.ts gets the same default so fresh DBs / tests inherit
-- it (dual-write pattern, same as 0022 / 0024 / 0025 / 0026 / 0028).
-- No schema changes — audit_log already has the right shape.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'task_rolled_over'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
