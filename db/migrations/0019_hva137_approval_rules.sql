-- =============================================================================
-- HVA-137: seed notification_rules for the captain approval gate
-- =============================================================================
--
-- Two rules — both in-app, both targeted at the assigned exec:
--   * request.approved → exec_assigned (celebratory: order complete)
--   * request.rejected → exec_assigned (captain requested changes)
--
-- Idempotent — relies on the UNIQUE (event_type, channel, recipient_role)
-- from 0012.
-- =============================================================================

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.approved', 'in_app', 'exec_assigned', true, NULL),
  ('request.rejected', 'in_app', 'exec_assigned', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
