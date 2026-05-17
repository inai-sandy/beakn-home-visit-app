-- =============================================================================
-- HVA-137: extend audit_enabled_events with the two approval events
-- =============================================================================
--
-- Same HVA-48 / HVA-108 dual-write pattern: lib/config-schema.ts carries
-- the default for fresh DBs / test harness; this migration patches
-- running prod where the config row already exists.
--
-- Idempotent — array_agg(DISTINCT) collapses re-runs.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT 'request_approved'
    UNION
    SELECT 'request_rejected_by_captain'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
