-- =============================================================================
-- HVA-48: notification rules engine — table + seed for first event wired
-- =============================================================================
--
-- Idempotent. ALTER ... IF NOT EXISTS / ON CONFLICT DO NOTHING guards let
-- the file re-run cleanly on a DB that's already been partially advanced.
--
-- Two rules seeded for the first proof (locked by Sandeep — see HVA-48
-- Phase 2 brief):
--   1. in_app channel → exec_assigned recipient role
--   2. email  channel → captain_assigning recipient role
--
-- All other rules from spec §15.2 (customer WhatsApp, super_admin
-- escalations, etc.) live in HVA-50.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_rules (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_type         varchar(100) NOT NULL,
  channel            varchar(20)  NOT NULL,
  recipient_role     varchar(50)  NOT NULL,
  enabled            boolean      NOT NULL DEFAULT true,
  template_key       varchar(100),
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  created_by_user_id uuid
);

DO $$ BEGIN
  ALTER TABLE notification_rules
    ADD CONSTRAINT notification_rules_created_by_user_id_users_id_fk
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_rules_event_enabled
  ON notification_rules (event_type, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_rules_unique
  ON notification_rules (event_type, channel, recipient_role);

-- Seed the two rules for request.assigned. ON CONFLICT uses the unique
-- index above so re-running the migration is a no-op.
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.assigned', 'in_app', 'exec_assigned',     true, NULL),
  ('request.assigned', 'email',  'captain_assigning', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;

-- Audit allow-list: extend with notification_dispatched (HVA-108 dual-write
-- pattern — same UPDATE applies the change to prod, lib/config-schema.ts
-- carries the default for fresh DBs / test harness).
UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT 'notification_dispatched'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
