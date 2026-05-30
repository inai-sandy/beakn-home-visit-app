-- HVA-199: append assist events to the live audit allow-list AND seed
-- notification_rules for the 5 new event types.
--
-- Dual-write pattern: `lib/config-schema.ts` defaults updated for fresh
-- installs; this migration updates the live `config.audit_enabled_events`
-- row on existing deployments. Identical UPDATE shape to migration 0044.

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'assist.created'
    UNION SELECT 'assist.approved'
    UNION SELECT 'assist.processing'
    UNION SELECT 'assist.dispatched'
    UNION SELECT 'assist.rejected'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';

-- Notification rules for the 5 new assist events.
--   assist.created      → captain (via new resolver 'assist_team_captain') + admin
--   assist.{approved,processing,dispatched,rejected} → exec (new resolver 'assist_submitter') + admin
-- All 5 events × in_app + push.
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('assist.created',    'in_app', 'assist_team_captain', true, NULL),
  ('assist.created',    'push',   'assist_team_captain', true, NULL),
  ('assist.created',    'in_app', 'super_admin',         true, NULL),
  ('assist.created',    'push',   'super_admin',         true, NULL),
  ('assist.approved',   'in_app', 'assist_submitter',    true, NULL),
  ('assist.approved',   'push',   'assist_submitter',    true, NULL),
  ('assist.approved',   'in_app', 'super_admin',         true, NULL),
  ('assist.approved',   'push',   'super_admin',         true, NULL),
  ('assist.processing', 'in_app', 'assist_submitter',    true, NULL),
  ('assist.processing', 'push',   'assist_submitter',    true, NULL),
  ('assist.processing', 'in_app', 'super_admin',         true, NULL),
  ('assist.processing', 'push',   'super_admin',         true, NULL),
  ('assist.dispatched', 'in_app', 'assist_submitter',    true, NULL),
  ('assist.dispatched', 'push',   'assist_submitter',    true, NULL),
  ('assist.dispatched', 'in_app', 'super_admin',         true, NULL),
  ('assist.dispatched', 'push',   'super_admin',         true, NULL),
  ('assist.rejected',   'in_app', 'assist_submitter',    true, NULL),
  ('assist.rejected',   'push',   'assist_submitter',    true, NULL),
  ('assist.rejected',   'in_app', 'super_admin',         true, NULL),
  ('assist.rejected',   'push',   'super_admin',         true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
