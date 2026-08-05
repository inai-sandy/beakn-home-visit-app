-- =============================================================================
-- HVA-326: tell the team when CartPlus cancels an order
-- =============================================================================
--
-- A CartPlus cancellation reaches the portal and silently cancels the
-- request at whatever stage it had reached — including Installation
-- Scheduled, where a captain has already blocked out the day. Four
-- production requests were cancelled this way with zero notifications sent.
--
-- Sandeep 2026-08-05: "once the order gets cancelled, it is cancelled. We
-- will handle it manually if the products got dispatched. But information
-- has to pass all the teams."
--
-- A cancellation event already exists (`request.cancelled_by_customer`) but
-- reusing it is wrong on two counts:
--   1. it WhatsApps the customer, who CartPlus has already told — the
--      customer would get the same news twice, from two systems;
--   2. support is not on its rules at all, and support is exactly who needs
--      to know when goods may already be on their way.
--
-- So: a distinct internal-only event. The existing customer-cancel flow is
-- left completely untouched.
--
-- CHANNELS: in_app + push only. No WhatsApp rule. There are already 13
-- disabled WhatsApp rules in this table waiting on Meta template approval;
-- adding a 14th that nobody can turn on would look like coverage while
-- delivering nothing. WhatsApp for this event is a follow-up, to be shipped
-- with its template, not ahead of it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Audit allow-list
-- ---------------------------------------------------------------------------
-- A cancellation that voids scheduled work and possibly-dispatched stock is
-- exactly the kind of event that must be reconstructable later.

UPDATE config
SET value = CASE
  WHEN value ? 'request_cancelled_in_cartplus' THEN value
  ELSE value || '["request_cancelled_in_cartplus"]'::jsonb
END
WHERE key = 'audit_enabled_events';

-- ---------------------------------------------------------------------------
-- Notification rules
-- ---------------------------------------------------------------------------
-- support_team_all is included deliberately: they hold the dispatch queue
-- and are the ones who must stop a shipment or start a recovery.
--
-- No `customer` rule. CartPlus owns the customer conversation for orders it
-- cancels.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.cancelled_in_cartplus', 'in_app', 'exec_assigned',       TRUE, NULL),
  ('request.cancelled_in_cartplus', 'in_app', 'captain_owning_city', TRUE, NULL),
  ('request.cancelled_in_cartplus', 'in_app', 'support_team_all',    TRUE, NULL),
  ('request.cancelled_in_cartplus', 'in_app', 'super_admin',         TRUE, NULL),
  ('request.cancelled_in_cartplus', 'push',   'exec_assigned',       TRUE, NULL),
  ('request.cancelled_in_cartplus', 'push',   'captain_owning_city', TRUE, NULL),
  ('request.cancelled_in_cartplus', 'push',   'support_team_all',    TRUE, NULL),
  ('request.cancelled_in_cartplus', 'push',   'super_admin',         TRUE, NULL)
ON CONFLICT DO NOTHING;
