-- =============================================================================
-- HVA-73 PR 2 + PR 3: extend audit_enabled_events with note_created
-- =============================================================================
--
-- Same dual-write pattern as 0022 / 0024 / 0025: lib/config-schema.ts
-- carries the default for fresh DBs / tests; this migration patches the
-- live prod config row so logEvent({ eventType: 'note_created', ... })
-- actually persists.
--
-- No schema changes — the notes table shipped in 0023 with the right
-- shape already (target_type / target_id / body / created_by_user_id /
-- created_at).
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'note_created'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
