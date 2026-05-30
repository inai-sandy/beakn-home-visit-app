-- 2026-05-30: per-user notification preferences.
--
-- The existing notification_rules table is global-per-role: every captain
-- gets the same rule set. This table lets individual users override the
-- default for any (event_type, channel) tuple.
--
-- Lookup model:
--   * Row exists with enabled=false → user has opted OUT, skip
--   * Row exists with enabled=true  → explicit opt-IN (same as rule default
--     today; future-proofing for a user opting into events not in the
--     default rule set)
--   * No row → use the rule's default (enabled if a rule exists, else
--     not eligible)
--
-- The engine reads this AFTER it resolves a user from a recipient_role, so
-- preferences are per-user. notification_rules still defines who is
-- *eligible* for an event.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type varchar(100) NOT NULL,
  channel notification_channel NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_unique
  ON notification_preferences (user_id, event_type, channel);

-- Per-user lookup index covers the engine's "is this user opted out?" query
-- (it always knows the user_id at dispatch time).
CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
  ON notification_preferences (user_id);
