-- =============================================================================
-- HVA-345: the exec and the captain are told when CartPlus confirms an order
-- =============================================================================
--
-- Since HVA-341 removed the portal's Order Confirmed button, CartPlus is the
-- ONLY way a request reaches ORDER_CONFIRMED. That path writes its status
-- history row directly instead of going through transitionRequestStatus, so
-- `status_transitions.emits_event` never fires and `request.order_confirmed`
-- went dead: 2 dispatches in the 30 days to 2026-08-21, both on 4 August, both
-- from the portal before the button was removed.
--
-- HVA-341 did wire support in, via `support.order_ready_for_dispatch`. The exec
-- who owns the order and the captain who owns the city were left out, so the
-- moment a sale is actually booked reached nobody who is measured on it.
--
-- Support is deliberately NOT a recipient of this event — they already hear
-- this exact moment through `support.order_ready_for_dispatch`, worded for the
-- dispatch queue. A second message for one event is the duplicate HVA-326 went
-- out of its way to avoid.
--
-- No customer rule: per Sandeep 2026-08-21, CartPlus keeps the customer for
-- order confirmation. It already sends them `cartplus_orderconfirmation` with
-- a receipt PDF, from the same WhatsApp number.
--
-- WhatsApp ships DISABLED: `internal_request_update_v1` has not been submitted
-- to Meta yet. An enabled rule against an unapproved template returns a
-- permanent INVALID_ARGUMENT on every send, recorded as a failed delivery
-- nothing alerts on — the HVA-306 failure mode. in_app and push are live now
-- and the WhatsApp rows flip in one UPDATE once Meta approves.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('webhook.cartplus.order_confirmed', 'in_app', 'exec_assigned',       true,  NULL),
  ('webhook.cartplus.order_confirmed', 'in_app', 'captain_owning_city', true,  NULL),
  ('webhook.cartplus.order_confirmed', 'push',   'exec_assigned',       true,  NULL),
  ('webhook.cartplus.order_confirmed', 'push',   'captain_owning_city', true,  NULL),
  ('webhook.cartplus.order_confirmed', 'whatsapp', 'exec_assigned',       false, 'internal_request_update_v1'),
  ('webhook.cartplus.order_confirmed', 'whatsapp', 'captain_owning_city', false, 'internal_request_update_v1')
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
