-- =============================================================================
-- HVA-39: append request_cancelled_by_customer to audit_enabled_events
-- =============================================================================
--
-- Dual-write pattern (matches earlier audit-event migrations): config row
-- gets the new event so existing prod DBs honour it; lib/config-schema.ts
-- defaults pick it up for fresh DBs / tests.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'request_cancelled_by_customer'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
