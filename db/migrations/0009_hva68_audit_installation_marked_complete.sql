-- HVA-68: extend audit_enabled_events with the
-- installation_marked_complete event. Emitted by /api/requests/[id]
-- /mark-installation-complete when an exec (or super_admin escape hatch)
-- moves a request to PENDING_CAPTAIN_APPROVAL.
--
-- Idempotent. Follows the HVA-108 / HVA-110 dual-write shape exactly
-- (migration + lib/config-schema.ts default). HVA-111 documents the
-- drizzle journal quirk that may require a manual force-apply on prod.

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT unnest(ARRAY['installation_marked_complete'])
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
