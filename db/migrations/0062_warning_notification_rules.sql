-- HVA-228: notification rules for the warnings feature.
--
-- Four events:
--   exec.soft_warning_issued  → in_app + push to the exec themselves
--   exec.hard_warning_issued  → in_app + push to the exec, plus
--                                whatsapp (shipped DISABLED until Meta
--                                approves `internal_hard_warning_v1`).
--   exec.warning_revoked      → in_app + push to the exec
--   exec.fifth_hard_warning   → in_app + push to super_admin
--
-- recipient_role 'exec' is the self-targeting variant (engine
-- resolves to context.execUserId — same as exec_assigned but the
-- semantic name reflects "this message is FOR the exec themselves",
-- not about a request they're assigned to). HVA-49 + HVA-155-C added
-- it to the engine.
--
-- Idempotent via UNIQUE (event_type, channel, recipient_role).

INSERT INTO notification_rules
  (event_type, channel, recipient_role, enabled, template_key)
VALUES
  -- Soft warning — in-app + push, always on.
  ('exec.soft_warning_issued', 'in_app',  'exec', true,  NULL),
  ('exec.soft_warning_issued', 'push', 'exec', true,  NULL),
  -- Hard warning — in-app + push always on; WhatsApp pending Meta.
  ('exec.hard_warning_issued', 'in_app',  'exec', true,  NULL),
  ('exec.hard_warning_issued', 'push', 'exec', true,  NULL),
  ('exec.hard_warning_issued', 'whatsapp', 'exec', false, 'internal_hard_warning_v1'),
  -- Revoke confirmation — in-app + push only.
  ('exec.warning_revoked',     'in_app',  'exec', true,  NULL),
  ('exec.warning_revoked',     'push', 'exec', true,  NULL),
  -- 5/5 alert to admin so Sandeep sees the banner trigger in-drawer too.
  ('exec.fifth_hard_warning',  'in_app',  'super_admin', true, NULL),
  ('exec.fifth_hard_warning',  'push', 'super_admin', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;

-- Add the four new event types to the audit allow-list. The config
-- table stores the allow-list as a JSON array under
-- `audit_enabled_events`. We merge new entries; existing entries
-- stay intact.
UPDATE config
   SET value = (
     SELECT to_jsonb(ARRAY(
       SELECT DISTINCT jsonb_array_elements_text(
         value || jsonb_build_array(
           'warning_issued',
           'warning_revoked',
           'user_deactivated'
         )
       )
     ))
   ),
       updated_at = NOW()
 WHERE key = 'audit_enabled_events';
