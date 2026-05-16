-- HVA-108: extend audit_enabled_events with the first-login password_set
-- event. Without this entry lib/audit.ts silently drops the row written
-- by app/set-password/actions.ts on every captain/exec onboarding.
--
-- Naming is intentional: `password_set` (first-login retirement of an
-- admin-issued temp credential) is semantically distinct from the
-- already-allowed `password_changed` (HVA-29 user-initiated change). A
-- single emit site (actions.ts:116) carries `reason='first_login_password_change'`
-- as well, so the two flows are double-discriminated.
--
-- Idempotent. Follows the HVA-110 (migration 0007) shape exactly.

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT unnest(ARRAY['password_set'])
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
