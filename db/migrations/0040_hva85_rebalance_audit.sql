-- =============================================================================
-- HVA-85: append request_reassigned_by_unavailable_rebalance to
--   audit_enabled_events
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'request_reassigned_by_unavailable_rebalance'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
