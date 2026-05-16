-- HVA-110: extend audit_enabled_events with the city-routing-email update
-- event. Without this entry lib/audit.ts silently drops the row (same
-- pattern HVA-108 documented for HVA-26 set-password). One single event_type
-- now; HVA-90 will add the rest of the cities-config audit surface
-- (discord_webhook_updated, other_routing_updated, support_phone_updated).
--
-- Idempotent: merges into the existing array, deduplicates.

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT unnest(ARRAY['city_routing_email_updated'])
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
