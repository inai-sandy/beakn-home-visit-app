-- =============================================================================
-- HVA-156: extend audit_enabled_events with content events
-- =============================================================================
--
-- Three new admin-fired event types from the content surfaces:
--   - resource_created     (admin posts a new resource)
--   - resource_updated     (admin edits an existing resource — sparse diff
--                            in before/after state)
--   - announcement_created (admin posts a new announcement; no
--                            announcement_updated since announcements are
--                            append-only per D8)
--
-- unpublish events ride the resource_updated / a new
-- announcement_unpublished event would be redundant — we just write
-- announcement_created and rely on is_published as the queryable state.
--
-- Dual-write pattern: lib/config-schema.ts defaults gain the same three
-- entries so fresh DBs / tests inherit them. Matches 0022 / 0024 / 0025 /
-- 0026 / 0028 / 0030.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'resource_created'
    UNION SELECT 'resource_updated'
    UNION SELECT 'announcement_created'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
