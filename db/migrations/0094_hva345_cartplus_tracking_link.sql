-- =============================================================================
-- HVA-345: the customer of a CartPlus order is finally sent their tracking link
-- =============================================================================
--
-- A CartPlus order that creates a new request has always generated a tracking
-- token, and has never told the customer it exists. Their /track page already
-- renders the order copy — line items, order value, and the subtotal /
-- discount / delivery / tax breakdown — so the page was live and unreachable.
--
-- HVA-282 left this out and recorded the reason as "blocked on a Meta-approved
-- template". That note went stale: `tracking_link_confirmation` was approved
-- on 2026-05-31 and has been sending on the web door ever since. Verified
-- against the live Libromi account on 2026-08-21 (43 approved templates, this
-- one among them), so the rule ships ENABLED rather than waiting on anything.
--
-- Its own event rather than reusing `request.created`: that event also carries
-- captain and super_admin rules, and both already hear about the order through
-- `webhook.cartplus.order_received` moments earlier. Reusing it would notify
-- them twice for one arrival.
--
-- Customer only. Per Sandeep 2026-08-21, CartPlus keeps the customer for order
-- confirmation and edits; the tracking link is the one customer message that is
-- Beakn's to send, because the destination is a Beakn page.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES ('webhook.cartplus.tracking_link_issued', 'whatsapp', 'customer', true, 'tracking_link_confirmation')
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
