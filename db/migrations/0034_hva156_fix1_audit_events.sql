-- =============================================================================
-- HVA-156-FIX1: extend audit_enabled_events with category events
-- =============================================================================
--
-- Two new admin-fired event types from the category CRUD surface:
--   - resource_category_created
--   - resource_category_updated  (covers rename / reorder / deactivate)
--
-- Dual-write pattern: lib/config-schema.ts defaults gain the same two
-- entries so fresh DBs / tests inherit them.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'resource_category_created'
    UNION SELECT 'resource_category_updated'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
