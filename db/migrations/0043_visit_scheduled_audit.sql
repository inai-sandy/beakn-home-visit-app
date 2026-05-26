-- =============================================================================
-- Schedule-Visit: append visit_scheduled to audit_enabled_events
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'visit_scheduled'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
