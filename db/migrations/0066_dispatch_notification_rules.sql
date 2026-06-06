-- HVA-240 (HVA-231 Phase 2 PR-C): notification rules for the support dispatch flow
--
-- Three event types fan out to different audiences:
--
--   support.order_ready_for_dispatch   → support_team_all (in_app + push)
--   support.dispatch_recorded          → exec_assigned + captain_owning_city
--                                        (in_app + push + whatsapp)
--   support.dispatch_advanced          → exec_assigned + captain_owning_city
--                                        (in_app + push + whatsapp)
--
-- WhatsApp rules ship `enabled=false` until Meta approves the templates:
--   internal_items_dispatched_v1
--   internal_dispatch_advanced_v1
--
-- Once Meta approves, admin flips enabled=true via
-- /admin/settings/notifications/rules (HVA-50 editor) or via direct SQL.

-- support.order_ready_for_dispatch — broadcast to active support users
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('support.order_ready_for_dispatch', 'in_app', 'support_team_all', true, NULL),
  ('support.order_ready_for_dispatch', 'push',   'support_team_all', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;

-- support.dispatch_recorded — exec + captain notified
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('support.dispatch_recorded', 'in_app',   'exec_assigned',         true,  NULL),
  ('support.dispatch_recorded', 'in_app',   'captain_owning_city',   true,  NULL),
  ('support.dispatch_recorded', 'push',     'exec_assigned',         true,  NULL),
  ('support.dispatch_recorded', 'push',     'captain_owning_city',   true,  NULL),
  -- WhatsApp shipped disabled until Meta approves. Sandeep flips
  -- enabled=true after approval. Same shape as HVA-228 hard-warning template.
  ('support.dispatch_recorded', 'whatsapp', 'exec_assigned',         false, 'internal_items_dispatched_v1'),
  ('support.dispatch_recorded', 'whatsapp', 'captain_owning_city',   false, 'internal_items_dispatched_v1')
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;

-- support.dispatch_advanced — exec + captain notified on each stage flip
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('support.dispatch_advanced', 'in_app',   'exec_assigned',         true,  NULL),
  ('support.dispatch_advanced', 'in_app',   'captain_owning_city',   true,  NULL),
  ('support.dispatch_advanced', 'push',     'exec_assigned',         true,  NULL),
  ('support.dispatch_advanced', 'push',     'captain_owning_city',   true,  NULL),
  ('support.dispatch_advanced', 'whatsapp', 'exec_assigned',         false, 'internal_dispatch_advanced_v1'),
  ('support.dispatch_advanced', 'whatsapp', 'captain_owning_city',   false, 'internal_dispatch_advanced_v1')
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;
