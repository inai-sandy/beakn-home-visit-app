-- HVA-54: Web Push subscription persistence + web_push notification rules.
--
-- One row per (user, endpoint). When the browser's PushManager hands us a
-- PushSubscription, we keep the endpoint + the two cryptographic keys
-- (p256dh + auth) needed to encrypt the push payload server-side via
-- web-push's sendNotification.
--
-- Subscriptions are tied to (user, browser, device) — a single user can
-- have many, and a device can be re-subscribed after the user reinstalls.
-- The endpoint is unique per push subscription, so it's the natural
-- dedupe key.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_used_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
  ON push_subscriptions (endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);

-- Seed web_push rules for every event_type that already has an in_app rule.
-- Net effect: once a user has at least one push_subscription, the same
-- events that hit their drawer also fire a browser push. ON CONFLICT
-- DO NOTHING keeps the seed idempotent if it runs twice.
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
SELECT DISTINCT event_type, 'push'::notification_channel, recipient_role, true, NULL
FROM notification_rules
WHERE channel = 'in_app'
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
