-- =============================================================================
-- HVA-95: append request_routed_from_other_queue to audit_enabled_events
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'request_routed_from_other_queue'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
