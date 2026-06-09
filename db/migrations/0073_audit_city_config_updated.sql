-- =============================================================================
-- HVA-258: backfill `city_config_updated` into the audit allow-list
-- =============================================================================
--
-- Dual-write violation found in the 2026-06-09 bug audit: the event is
-- in lib/config-schema.ts defaults and emitted by
-- app/api/admin/cities/[id]/route.ts, but no migration ever appended it
-- to the prod `audit_enabled_events` config row (seeding uses ON
-- CONFLICT DO NOTHING, so defaults never reach an existing row). Result:
-- every city-config audit event has been silently dropped on prod.
--
-- Same idempotent CASE pattern as migrations 0068–0072.

UPDATE config
SET value = CASE
  WHEN value ? 'city_config_updated' THEN value
  ELSE value || '["city_config_updated"]'::jsonb
END
WHERE key = 'audit_enabled_events';
