-- =============================================================================
-- 0080 — notification wiring fixes
-- =============================================================================
--
-- Two independent rule changes that pair with code fixes in the same PR:
--
-- (B) Disable three internal WhatsApp rules that migration 0069 flipped to
--     enabled=TRUE even though no WhatsApp composer is registered for their
--     template_keys. Every send for these currently fails at composer lookup
--     (`no_whatsapp_composer_for_<key>`) and is recorded as a failed
--     delivery. The in_app + push channels for these same events are
--     unaffected. Return them to the dormant state every other internal
--     WhatsApp rule is in; re-enable once composers are authored (the Meta
--     templates themselves are already approved).
--
-- (C) Seed the request.approval_overdue rule. The stale-approvals cron
--     (lib/cron/escalate-stale-approvals.ts) already dispatches this event
--     with cityCaptainUserId in context, and this PR adds the in-app
--     composer — but no notification_rules row existed, so it matched
--     nothing (rulesMatched=0). Notify the owning city captain in-app + push.
-- =============================================================================

-- (B) Disable the composer-less internal WhatsApp rules.
UPDATE notification_rules
SET enabled = FALSE
WHERE template_key IN (
  'internal_hard_warning_v1',
  'internal_items_dispatched_v1',
  'internal_dispatch_advanced_v1'
);

-- (C) Seed request.approval_overdue for the owning city captain.
INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.approval_overdue', 'in_app', 'captain_owning_city', TRUE, NULL),
  ('request.approval_overdue', 'push',   'captain_owning_city', TRUE, NULL)
ON CONFLICT DO NOTHING;
