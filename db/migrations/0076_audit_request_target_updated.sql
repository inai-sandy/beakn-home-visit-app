-- =============================================================================
-- HVA-281: enable the `request_target_updated` audit event
-- =============================================================================
--
-- Dual-write rule: a new audit event must be appended to the live
-- `audit_enabled_events` config row AND added to lib/config-schema.ts
-- defaults (seeding uses ON CONFLICT DO NOTHING, so defaults never reach
-- an existing row). Same idempotent CASE pattern as migration 0073.
-- =============================================================================

UPDATE config
SET value = CASE
  WHEN value ? 'request_target_updated' THEN value
  ELSE value || '["request_target_updated"]'::jsonb
END
WHERE key = 'audit_enabled_events';
