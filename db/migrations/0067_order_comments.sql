-- =============================================================================
-- HVA-241 (HVA-231 Phase 3): order_comments
-- =============================================================================
--
-- Slack-thread-style comments pinned to a visit_request. Append-only, no
-- edit/delete (mirrors the notes contract). Visible to support + assigned
-- exec + assigned captain + super_admin; customer never sees these.
--
-- Threading is a single-level parent_comment_id pointer; the UI renders
-- replies indented under their parent. No deeper nesting on purpose —
-- Slack-style "one reply level" keeps the read pattern obvious.
--
-- mentions JSONB holds an array of mentioned user_id strings. Engine fan-
-- out reads it back to push extra in-app/push notifications beyond the
-- default support_team_all + assigned exec + assigned captain.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_comments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  request_id        UUID NOT NULL REFERENCES visit_requests(id) ON DELETE CASCADE,
  author_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_comment_id UUID REFERENCES order_comments(id) ON DELETE RESTRICT,
  body              TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  mentions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Timeline read: load all comments for a request in chronological order.
CREATE INDEX IF NOT EXISTS order_comments_request_created_idx
  ON order_comments (request_id, created_at);

-- Author lookup (audit / "what has this user posted?").
CREATE INDEX IF NOT EXISTS order_comments_author_idx
  ON order_comments (author_user_id);

-- Reply lookup ("show me replies to this comment").
CREATE INDEX IF NOT EXISTS order_comments_parent_idx
  ON order_comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

-- audit_log.event_type is varchar(100), no enum to extend.
--
-- Extend audit_enabled_events default so new installs / testcontainers
-- get the new event in their allow-list. The live config row is also
-- updated below; lib/config-schema.ts defaults are updated in the same PR
-- (dual-write rule from HVA-240 retrospective).
UPDATE config
SET value = CASE
  WHEN value ? 'order_comment_added' THEN value
  ELSE value || '["order_comment_added"]'::jsonb
END
WHERE key = 'audit_enabled_events';

-- Seed notification rules for the new event. WhatsApp deferred (too
-- chatty for thread updates). In-app + push only.
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('support.order_comment_added', 'in_app', 'exec_assigned',       TRUE,  NULL),
  ('support.order_comment_added', 'in_app', 'captain_owning_city', TRUE,  NULL),
  ('support.order_comment_added', 'in_app', 'support_team_all',    TRUE,  NULL),
  ('support.order_comment_added', 'in_app', 'mentioned_users',     TRUE,  NULL),
  ('support.order_comment_added', 'push',   'exec_assigned',       TRUE,  NULL),
  ('support.order_comment_added', 'push',   'captain_owning_city', TRUE,  NULL),
  ('support.order_comment_added', 'push',   'support_team_all',    TRUE,  NULL),
  ('support.order_comment_added', 'push',   'mentioned_users',     TRUE,  NULL)
ON CONFLICT DO NOTHING;
