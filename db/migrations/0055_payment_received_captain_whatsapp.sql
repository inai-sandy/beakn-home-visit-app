-- payment.received → captain WhatsApp rule
--
-- The `payment.received` event is already emitted by the
-- /api/requests/[id]/payments POST route (HVA-125 wiring landed
-- 2026-05-30). Until today there were zero notification rules for it,
-- so the dispatch was a no-op (engine: rulesMatched=0).
--
-- This seeds the FIRST rule: captain_owning_city → WhatsApp →
-- `captain_payment_received` template. Recipient is the captain who
-- owns the city of the request (NOT the actor who clicked record —
-- per the architectural attribution-vs-action-taker principle saved
-- to memory 2026-06-01).
--
-- enabled=false because the template is pending Meta approval. After
-- Meta approves, run:
--   UPDATE notification_rules
--      SET enabled = true
--      WHERE channel = 'whatsapp'
--        AND template_key = 'captain_payment_received';
--
-- Idempotent via the existing UNIQUE (event_type, channel, recipient_role).

INSERT INTO notification_rules
  (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('payment.received', 'whatsapp', 'captain_owning_city', false, 'captain_payment_received')
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled      = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;
