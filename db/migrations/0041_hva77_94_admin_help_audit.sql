-- =============================================================================
-- HVA-77 + HVA-94: append admin_help_* events to audit_enabled_events
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'admin_help_sent'
    UNION SELECT 'admin_help_replied'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
