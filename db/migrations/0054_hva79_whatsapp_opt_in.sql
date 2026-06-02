-- HVA-79: customer WhatsApp opt-in captured on the public /request form.
--
-- Stored on the visit_requests row so EVERY downstream dispatch
-- (request.scheduled, request.rescheduled, request.quotation_submitted,
-- etc.) can short-circuit the WhatsApp channel cleanly when the
-- customer opted out. The notification engine's `customer` recipient
-- resolver reads context.customerWhatsappOptIn before resolving the
-- target phone — opted-out customers get an audit row with
-- `status: 'skipped'` and reason `customer opted out of whatsapp`, not
-- a permanent failure.
--
-- Default TRUE because:
--   1. Every request created before HVA-79 shipped was already
--      receiving WhatsApps under the prior implicit-opt-in behaviour;
--      flipping them to FALSE on migration day would silently disable
--      messages for live customers expecting updates.
--   2. The form ships with the checkbox default-checked, so the
--      column default matches the form default.
--
-- Customers can still see status updates on the /track page even when
-- opted-out — only the WhatsApp template is suppressed.

ALTER TABLE visit_requests
  ADD COLUMN whatsapp_opt_in BOOLEAN NOT NULL DEFAULT TRUE;
