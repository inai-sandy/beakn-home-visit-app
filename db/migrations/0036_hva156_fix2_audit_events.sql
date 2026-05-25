-- =============================================================================
-- HVA-156-FIX2: extend audit_enabled_events with announcement-category
-- events + announcement_acknowledged
-- =============================================================================
--
-- New event types:
--   * announcement_category_created
--   * announcement_category_updated (rename / reorder / deactivate)
--   * announcement_acknowledged (per-user one-way tap)
--
-- Dual-write pattern: lib/config-schema.ts defaults gain the same three
-- entries so fresh DBs / tests inherit them.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'announcement_category_created'
    UNION SELECT 'announcement_category_updated'
    UNION SELECT 'announcement_acknowledged'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
