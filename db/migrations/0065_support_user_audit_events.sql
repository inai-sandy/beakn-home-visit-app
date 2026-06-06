-- HVA-236 (HVA-235-FIX1): support team admin events audit allow-list
--
-- Same dual-write pattern as the earlier audit-allow-list updates.
-- lib/config-schema.ts default already includes these 5 events;
-- this UPDATE merges them into the live config row so the prod
-- audit_log starts capturing them on the deploy that includes this migration.

UPDATE config
   SET value = (
     SELECT to_jsonb(ARRAY(
       SELECT DISTINCT jsonb_array_elements_text(
         value || jsonb_build_array(
           'support_user_created',
           'support_user_updated',
           'support_user_deactivated',
           'support_user_activated',
           'support_user_password_reset'
         )
       )
     ))
   ),
       updated_at = NOW()
 WHERE key = 'audit_enabled_events';
