-- 2026-05-29: HVA-52/79/87 followup — seed the missing notification_rules
-- that left the captain + admin bells feeling dead.
--
-- Diagnosis: only ONE captain rule existed (request.rolled_back via HVA-141)
-- and ZERO admin rules. The engine + composers + UI all worked; the rule
-- table was just sparse.
--
-- This migration:
--   1. Adds in_app rules for captain_owning_city on
--      request.cancelled_by_customer + request.rescheduled.
--      (composers for both shipped in the same PR)
--   2. Adds in_app rules for super_admin on three role-neutral events
--      (rolled_back, cancelled_by_customer, rescheduled). Admin gets
--      org-wide visibility on these events.
--   3. Mirrors all five new rules to the push channel so subscribed
--      browsers also get OS-level pushes (HVA-54).
--
-- All inserts use ON CONFLICT DO NOTHING against the existing
-- (event_type, channel, recipient_role) unique index so re-running is safe.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  -- Captain (in-app)
  ('request.cancelled_by_customer', 'in_app', 'captain_owning_city', true, NULL),
  ('request.rescheduled',           'in_app', 'captain_owning_city', true, NULL),
  -- Admin (in-app)
  ('request.rolled_back',           'in_app', 'super_admin', true, NULL),
  ('request.cancelled_by_customer', 'in_app', 'super_admin', true, NULL),
  ('request.rescheduled',           'in_app', 'super_admin', true, NULL),
  -- Same five mirrored to web push so subscribed devices also get OS pushes.
  ('request.cancelled_by_customer', 'push',   'captain_owning_city', true, NULL),
  ('request.rescheduled',           'push',   'captain_owning_city', true, NULL),
  ('request.rolled_back',           'push',   'super_admin', true, NULL),
  ('request.cancelled_by_customer', 'push',   'super_admin', true, NULL),
  ('request.rescheduled',           'push',   'super_admin', true, NULL)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
