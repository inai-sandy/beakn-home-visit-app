-- =============================================================================
-- HVA-140: seed notification_rules for request.reassigned
-- =============================================================================
--
-- Three rules:
--   * in_app → exec_removed   (the exec being taken off the request)
--   * in_app → exec_assigned  (the new exec receiving the handoff)
--   * email  → captain_acting (the captain who clicked Reassign — confirmation)
--
-- Idempotent — relies on the UNIQUE (event_type, channel, recipient_role)
-- from 0012.
-- =============================================================================

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.reassigned', 'in_app', 'exec_removed',  true, NULL),
  ('request.reassigned', 'in_app', 'exec_assigned', true, NULL),
  ('request.reassigned', 'email',  'captain_acting', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
