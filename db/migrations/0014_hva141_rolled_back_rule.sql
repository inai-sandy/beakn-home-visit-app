-- =============================================================================
-- HVA-141: seed notification_rules for request.rolled_back
-- =============================================================================
--
-- Single rule: in-app drawer for the captain who owns the request's
-- city. Email / WhatsApp / Discord are deferred (HVA-50 expands the
-- recipient matrix once notification surfaces stabilise).
--
-- Idempotent — relies on the existing UNIQUE (event_type, channel,
-- recipient_role) from 0012.
-- =============================================================================

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.rolled_back', 'in_app', 'captain_owning_city', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
