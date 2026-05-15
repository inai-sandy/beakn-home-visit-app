-- HVA-67: seed the remaining 9 status_stages (Phase 1 lifecycle).
-- Sequence_number 1 ('Submitted') already seeded by HVA-33's 0004 migration;
-- this migration adds sequence 2 through 10 idempotently.
--
-- ON CONFLICT (code) DO NOTHING — both code and sequence_number have UNIQUE
-- constraints. Re-running this migration on an already-seeded DB is a no-op.
INSERT INTO status_stages (code, name, sequence_number, is_active) VALUES
  ('ASSIGNED',                       'Assigned',                          2,  true),
  ('VISIT_SCHEDULED',                'Visit Scheduled',                   3,  true),
  ('VISIT_COMPLETED',                'Visit Completed',                   4,  true),
  ('QUOTATION_GIVEN',                'Quotation Given',                   5,  true),
  ('ORDER_CONFIRMED',                'Order Confirmed',                   6,  true),
  ('INSTALLATION_SCHEDULED',         'Installation Scheduled',            7,  true),
  ('INSTALLATION_CONFIGURATION_DONE','Installation & Configuration Done', 8,  true),
  ('PENDING_CAPTAIN_APPROVAL',       'Pending Captain Approval',          9,  true),
  ('ORDER_EXECUTED_SUCCESSFULLY',    'Order Executed Successfully',       10, true)
ON CONFLICT (code) DO NOTHING;
