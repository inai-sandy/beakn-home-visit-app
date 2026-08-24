-- =============================================================================
-- HVA-343: the last twelve WhatsApp rules come on — the backlog is cleared
-- =============================================================================
--
-- Meta approved the remaining seven templates on 2026-08-24. Verified against
-- the live Libromi account before writing this migration: all 52 templates on
-- the account read APPROVED, none PENDING or REJECTED, and for each of the
-- eight submitted the number of {{n}} placeholders in the APPROVED body equals
-- the number of parameters its composer emits:
--
--   internal_portal_order_received_v1     6 = 6   (enabled by 0096)
--   internal_request_update_v1            4 = 4
--   installation_scheduled                3 = 3
--   internal_items_dispatched_v1          5 = 5
--   internal_dispatch_advanced_v1         5 = 5
--   support_ticket_resolved               3 = 3
--   internal_support_ticket_received_v1   4 = 4
--   internal_support_ticket_reply_v1      4 = 4
--
-- Parameter parity is the thing that has to be checked rather than assumed: a
-- count mismatch is rejected by the provider on every send, and the failure is
-- recorded as a failed delivery nothing alerts on. Each approved body was also
-- confirmed to be BODY-only — a header or button component the composer does
-- not populate fails the same way.
--
-- This clears the backlog that has stood since 2026-06-04. These twelve rules
-- were seeded disabled and never switched on, which is why WhatsApp was silent
-- for every order and status event Sandeep reported on 2026-08-21.
--
-- Scoped by template_key rather than a blanket `enabled = true` on the channel:
-- a future rule seeded disabled for a template still awaiting approval must not
-- be swept along by this migration.

UPDATE notification_rules
SET enabled = true,
    updated_at = now()
WHERE channel = 'whatsapp'
  AND enabled = false
  AND template_key IN (
    'internal_request_update_v1',
    'installation_scheduled',
    'internal_items_dispatched_v1',
    'internal_dispatch_advanced_v1',
    'support_ticket_resolved',
    'internal_support_ticket_received_v1',
    'internal_support_ticket_reply_v1'
  );
