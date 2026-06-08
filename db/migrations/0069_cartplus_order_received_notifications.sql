-- =============================================================================
-- HVA-250 (HVA-230 Phase 2.A): notification rules for portal order_received
-- + flip previously-approved WhatsApp templates (HVA-228, HVA-240)
-- =============================================================================
--
-- The handler in lib/webhooks/cartplus/handler-order-created.ts fires
-- dispatchNotification('webhook.cartplus.order_received', {...}) after a
-- successful create. This migration seeds the rules.
--
-- WhatsApp template `internal_portal_order_received_v1` ships disabled —
-- Sandeep submits it to Meta in parallel with this PR; flip enabled=true
-- in a follow-up migration once approved.
--
-- Sandeep 2026-06-08: previously-pending templates are now Meta-approved:
--   internal_hard_warning_v1
--   internal_items_dispatched_v1
--   internal_dispatch_advanced_v1
-- Flip them enabled=true here so production starts firing immediately.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Audit allow-list — let webhook.cartplus.order_received be auditable
-- ---------------------------------------------------------------------------

UPDATE config
SET value = CASE
  WHEN value ? 'webhook_cartplus_order_received' THEN value
  ELSE value || '["webhook_cartplus_order_received"]'::jsonb
END
WHERE key = 'audit_enabled_events';

-- ---------------------------------------------------------------------------
-- Notification rules for portal order_received
-- ---------------------------------------------------------------------------
-- in_app + push always-on for the 3 internal roles.
-- WhatsApp shipped enabled=false; Sandeep flips after Meta approves the
-- `internal_portal_order_received_v1` template.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('webhook.cartplus.order_received', 'in_app', 'exec_assigned',       TRUE,  NULL),
  ('webhook.cartplus.order_received', 'in_app', 'captain_owning_city', TRUE,  NULL),
  ('webhook.cartplus.order_received', 'in_app', 'super_admin',         TRUE,  NULL),
  ('webhook.cartplus.order_received', 'push',   'exec_assigned',       TRUE,  NULL),
  ('webhook.cartplus.order_received', 'push',   'captain_owning_city', TRUE,  NULL),
  ('webhook.cartplus.order_received', 'push',   'super_admin',         TRUE,  NULL),
  ('webhook.cartplus.order_received', 'whatsapp', 'exec_assigned',       FALSE, 'internal_portal_order_received_v1'),
  ('webhook.cartplus.order_received', 'whatsapp', 'captain_owning_city', FALSE, 'internal_portal_order_received_v1')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- HVA-253 (bundled): flip previously-approved WhatsApp templates ON
-- ---------------------------------------------------------------------------
-- Sandeep 2026-06-08: Meta approval complete for the three templates
-- below. These rules originally shipped enabled=false in migrations 0062
-- (warnings), 0066 (dispatch). Flipping now activates real WhatsApp
-- delivery for exec/captain notifications.

UPDATE notification_rules
SET enabled = TRUE
WHERE channel = 'whatsapp'
  AND template_key IN (
    'internal_hard_warning_v1',
    'internal_items_dispatched_v1',
    'internal_dispatch_advanced_v1'
  );
