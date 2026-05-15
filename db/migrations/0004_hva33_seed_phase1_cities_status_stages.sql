ALTER TABLE "visit_requests" ADD COLUMN "location_accuracy" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "visit_requests" ADD COLUMN "customer_state" varchar(100);--> statement-breakpoint

-- HVA-33 seed: 9 cities (8 + Other) + the Submitted status stage.
-- Both seeds are idempotent so re-running the migration on an already-
-- seeded database is a no-op.

INSERT INTO cities (name, state, is_active) VALUES
  ('Hyderabad',  'Telangana',      true),
  ('Bangalore',  'Karnataka',      true),
  ('Chennai',    'Tamil Nadu',     true),
  ('Ahmedabad',  'Gujarat',        true),
  ('Vizag',      'Andhra Pradesh', true),
  ('Vijayawada', 'Andhra Pradesh', true),
  ('Mumbai',     'Maharashtra',    true),
  ('Pune',       'Maharashtra',    true),
  ('Other',      NULL,             true)
ON CONFLICT (name) DO NOTHING;

--> statement-breakpoint

INSERT INTO status_stages (code, name, sequence_number, is_active) VALUES
  ('SUBMITTED', 'Submitted', 1, true)
ON CONFLICT (code) DO NOTHING;
