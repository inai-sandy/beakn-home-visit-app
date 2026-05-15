-- HVA-91/92: extend audit_enabled_events with admin CRUD events.
--
-- The original config row (seeded by scripts/seed-config.ts) lists Phase-1
-- request-lifecycle events only. Captain + sales-exec admin actions now
-- log to audit_log via lib/audit.ts, but only if their event_type is in
-- the allow-list. This migration merges the new event types into the
-- existing JSON array idempotently.
--
-- Re-running on an already-extended DB is a no-op (each event is only
-- added when it's not already present, via array-diff aggregation).

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT unnest(ARRAY[
      'captain_created',
      'captain_updated',
      'captain_password_reset',
      'captain_deactivated',
      'captain_activated',
      'executive_created',
      'executive_updated',
      'executive_password_reset',
      'executive_deactivated',
      'executive_activated'
    ])
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
