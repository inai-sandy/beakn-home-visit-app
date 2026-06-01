-- HVA-49 + HVA-155 Part C: seed 13 internal WhatsApp notification rules.
--
-- These templates are pending Meta approval at the time of this ship.
-- enabled = false ensures the engine doesn't attempt the Libromi send
-- and log permanent failures while we wait. Once Sandeep confirms a
-- template is APPROVED, a single UPDATE flips enabled = true and the
-- next dispatch fires the WhatsApp.
--
-- Flip-to-live SQL after Meta approval (run per template, NOT all at
-- once — flip only the ones approved so far):
--
--   UPDATE notification_rules
--     SET enabled = true
--     WHERE channel = 'whatsapp'
--       AND template_key = '<template_name>';
--
-- See:
--   /var/www/beakn-docs/beakn-whatsapp-templates-internal.md (bodies)
--   /var/www/beakn-docs/beakn-whatsapp-trigger-map.md (event-to-channel matrix)
--
-- ON CONFLICT keeps the migration idempotent against the existing
-- (event_type, channel, recipient_role) UNIQUE.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  -- ============================================================
  -- Tier 1: recommended — high-action moments needing WhatsApp
  -- ============================================================
  ('request.assigned',              'whatsapp', 'exec_assigned',       false, 'exec_request_assigned'),
  ('request.rescheduled',           'whatsapp', 'exec_assigned',       false, 'exec_visit_rescheduled'),
  ('request.approved',              'whatsapp', 'exec_assigned',       false, 'exec_request_approved'),
  ('request.rejected',              'whatsapp', 'exec_assigned',       false, 'exec_request_rejected'),
  ('cron.day_close_reminder',       'whatsapp', 'exec',                false, 'exec_day_close_reminder'),
  ('request.created',               'whatsapp', 'captain_owning_city', false, 'captain_new_request'),
  ('request.pending_approval',      'whatsapp', 'captain_owning_city', false, 'captain_pending_approval'),

  -- ============================================================
  -- Tier 2: optional — broader WhatsApp coverage
  -- ============================================================
  ('request.reassigned',            'whatsapp', 'exec_assigned',       false, 'exec_request_reassigned_to_you'),
  ('request.reassigned',            'whatsapp', 'exec_removed',        false, 'exec_request_reassigned_off_you'),
  ('request.cancelled_by_customer', 'whatsapp', 'exec_assigned',       false, 'exec_customer_cancelled'),
  ('assist.approved',               'whatsapp', 'assist_submitter',    false, 'exec_assist_approved'),
  ('assist.rejected',               'whatsapp', 'assist_submitter',    false, 'exec_assist_rejected'),
  ('assist.created',                'whatsapp', 'assist_team_captain', false, 'captain_assist_request')
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;
