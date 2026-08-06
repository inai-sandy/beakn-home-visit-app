-- =============================================================================
-- HVA-329: a customer-initiated cancellation reaches support too
-- =============================================================================
--
-- HVA-326 shipped `request.cancelled_in_cartplus` with `support_team_all` on
-- in_app + push, on the reasoning that support hold the dispatch queue and are
-- exactly who needs to know when goods may already be on their way. Its own
-- migration (0088) said so out loud about the OTHER door:
--
--   "support is not on its rules at all, and support is exactly who needs to
--    know when goods may already be on their way."
--
-- That sentence was written about `request.cancelled_by_customer` — the
-- /track "Cancel request" button — and the fix was scoped to the CartPlus
-- path only. So the gap it described stayed open.
--
-- Verified on production 2026-08-06 by cancelling a ZZTEST request from the
-- tracking page: `request.cancelled_by_customer` was delivered to the assigned
-- exec, the owning captain and both super_admins, and to zero support users.
-- Meanwhile the order's items sat in the support Pending queue (HVA-328).
--
-- CHANNELS: in_app + push, matching what the other three internal roles
-- already get on this event. No WhatsApp rule — 13 disabled WhatsApp rules
-- already sit in this table awaiting Meta template approval, and a 14th would
-- look like coverage while delivering nothing.
--
-- The customer's own WhatsApp on this event is untouched; they already get it
-- and this migration does not go near that rule.
-- =============================================================================

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.cancelled_by_customer', 'in_app', 'support_team_all', TRUE, NULL),
  ('request.cancelled_by_customer', 'push',   'support_team_all', TRUE, NULL)
ON CONFLICT DO NOTHING;
