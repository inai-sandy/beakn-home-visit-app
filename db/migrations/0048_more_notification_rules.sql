-- 2026-05-30: seed rules for the two new notification events plus the
-- exec-side gap for customer cancel + reschedule.
--
-- Events newly dispatched:
--   request.created             — customer raised a new request (POST /api/customer-request)
--   request.pending_approval    — status transitioned into PENDING_CAPTAIN_APPROVAL
--
-- Plus exec_assigned rules for two existing events that previously only
-- pinged captain + admin:
--   request.cancelled_by_customer → exec who was handling it
--   request.rescheduled           → exec who was handling it

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  -- Captain + admin on new customer request
  ('request.created',          'in_app', 'captain_owning_city', true, NULL),
  ('request.created',          'push',   'captain_owning_city', true, NULL),
  ('request.created',          'in_app', 'super_admin',         true, NULL),
  ('request.created',          'push',   'super_admin',         true, NULL),
  -- Captain + admin on PENDING_CAPTAIN_APPROVAL entry
  ('request.pending_approval', 'in_app', 'captain_owning_city', true, NULL),
  ('request.pending_approval', 'push',   'captain_owning_city', true, NULL),
  ('request.pending_approval', 'in_app', 'super_admin',         true, NULL),
  ('request.pending_approval', 'push',   'super_admin',         true, NULL),
  -- Exec gets pinged when their request is cancelled or rescheduled
  ('request.cancelled_by_customer', 'in_app', 'exec_assigned', true, NULL),
  ('request.cancelled_by_customer', 'push',   'exec_assigned', true, NULL),
  ('request.rescheduled',           'in_app', 'exec_assigned', true, NULL),
  ('request.rescheduled',           'push',   'exec_assigned', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
