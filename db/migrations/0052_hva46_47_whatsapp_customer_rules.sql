-- HVA-46 + HVA-47: seed 8 customer-facing WhatsApp notification rules.
-- Each rule fires the corresponding Meta-approved template via the
-- `customer` recipient role → context.customerPhone (E.164).
--
-- All 8 templates are body-only Utility templates approved on Libromi
-- (see /var/www/beakn-docs/beakn-whatsapp-templates.md).
--
-- The composer registry in lib/notifications/compose/whatsapp-events.ts
-- looks up by event_type and reads template_key to pick the Meta name —
-- so a future admin-editable rebrand is a single UPDATE on this table.
--
-- ON CONFLICT clause matches the (event_type, channel, recipient_role)
-- UNIQUE constraint so this migration is safely idempotent.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.created',                'whatsapp', 'customer', true, 'tracking_link_confirmation'),
  ('request.scheduled',              'whatsapp', 'customer', true, 'visit_scheduled'),
  ('request.rescheduled',            'whatsapp', 'customer', true, 'visit_rescheduled'),
  ('request.quotation_submitted',    'whatsapp', 'customer', true, 'quotation_ready'),
  ('request.order_confirmed',        'whatsapp', 'customer', true, 'order_confirmed'),
  ('request.installation_complete',  'whatsapp', 'customer', true, 'installation_complete'),
  ('request.cancelled_by_customer',  'whatsapp', 'customer', true, 'customer_cancellation_received'),
  ('request.rejected',               'whatsapp', 'customer', true, 'we_had_to_cancel')
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET enabled     = EXCLUDED.enabled,
      template_key = EXCLUDED.template_key;
