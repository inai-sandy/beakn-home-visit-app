-- =============================================================================
-- HVA-343: order-received WhatsApp goes live for the exec and the captain
-- =============================================================================
--
-- `internal_portal_order_received_v1` was APPROVED by Meta on 2026-08-24,
-- verified against the live Libromi account before this migration was written:
-- status APPROVED, category UTILITY, language en, and a body carrying exactly
-- six placeholders in the order the composer emits them —
--   {{1}} recipient first name · {{2}} customer · {{3}} order number ·
--   {{4}} order total · {{5}} city · {{6}} request URL
-- — byte-identical to the copy submitted, so the composer needs no change.
--
-- This is the rule Sandeep called the most important of the set: a new order
-- or quotation arriving from CartPlus, to the exec who owns it and the captain
-- who owns the city. It has sat enabled=false since 2026-06-08 waiting on this
-- approval.
--
-- Flipped ALONE, not batched. The other seven templates submitted with it are
-- still PENDING at Meta; enabling any of those now would return a permanent
-- INVALID_ARGUMENT on every send, recorded as a failed delivery nothing alerts
-- on. Each gets its own flip as its approval lands.

UPDATE notification_rules
SET enabled = true,
    updated_at = now()
WHERE event_type = 'webhook.cartplus.order_received'
  AND channel = 'whatsapp'
  AND template_key = 'internal_portal_order_received_v1';
