-- HVA-70: Collection (quotations + payments) section.
-- Extends pre-existing tables seeded in HVA-14 (quotations + payments)
-- to match HVA-70's session-prompt design.
--
-- Idempotent. ALTER ... IF NOT EXISTS guards + IF NOT EXISTS on the new
-- enum let this re-run cleanly on prod (which is the HVA-111 workaround
-- target until the journal is fixed).

-- 1. Quotations: notes + updated_by + quotation_number nullable.
ALTER TABLE quotations ALTER COLUMN quotation_number DROP NOT NULL;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS updated_by_user_id uuid;
DO $$ BEGIN
  ALTER TABLE quotations
    ADD CONSTRAINT quotations_updated_by_user_id_users_id_fk
    FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. payment_direction enum (inbound/outbound).
DO $$ BEGIN
  CREATE TYPE payment_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Payments: direction (defaulted inbound for backfill), label, notes,
--    voided_*, reference_number nullable.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS direction payment_direction NOT NULL DEFAULT 'inbound';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS label varchar(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS voided_at timestamp with time zone;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by_user_id uuid;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_reason text;
DO $$ BEGIN
  ALTER TABLE payments
    ADD CONSTRAINT payments_voided_by_user_id_users_id_fk
    FOREIGN KEY (voided_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE payments ALTER COLUMN reference_number DROP NOT NULL;
CREATE INDEX IF NOT EXISTS payments_direction_idx ON payments (direction);

-- 4. payment_mode: extend with Card + Other.
--    NOTE: HVA-14's enum is Title Case ('Cash','UPI','Bank Transfer',
--    'Cheque'). HVA-70 session prompt suggested lowercase ('card',
--    'other'); we MATCH the existing taxonomy capitalization to avoid
--    breaking the pre-seeded enum + any future data that uses these
--    values. Documented as a deviation in the Linear body.
ALTER TYPE payment_mode ADD VALUE IF NOT EXISTS 'Card';
ALTER TYPE payment_mode ADD VALUE IF NOT EXISTS 'Other';

-- 5. Audit allow-list: 5 new event types (HVA-108 dual-write pattern).
UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT unnest(ARRAY[
      'quotation_created',
      'quotation_updated',
      'payment_recorded',
      'refund_recorded',
      'payment_voided'
    ])
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
