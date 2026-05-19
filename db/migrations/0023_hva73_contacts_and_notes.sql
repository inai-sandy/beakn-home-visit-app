-- =============================================================================
-- HVA-73 PR 1: Contacts with multi-request support + notes table foundation
-- =============================================================================
--
-- Conceptual shift: leads become "contacts." A contact may have multiple
-- requests over time (e.g. an interior designer who books three jobs).
-- The leads TABLE keeps its name; only the UI label is changing to
-- "Contacts" (per D5). No data backfill: legacy rows stay NULL.
--
-- Three idempotent statements:
--   1. visit_requests.contact_id     — FK back to leads (nullable; legacy
--                                      direct-form requests stay NULL).
--   2. visit_requests_contact_idx    — index on contact_id for the new
--                                      "all requests for this contact"
--                                      query on the detail page.
--   3. notes table (append-only)     — polymorphic over request | contact
--                                      via (target_type, target_id). UI
--                                      ships in PR 2 / PR 3.
--
-- leads.converted_to_request_id semantics shift (no DDL change here;
-- the inline schema comment is updated in db/schema/leads.ts):
--   was: the request this lead was converted to (1:1).
--   now: the FIRST request created from this lead, kept for legacy
--        reference. Subsequent re-conversions create new requests with
--        contact_id pointing back to the same lead.
-- =============================================================================

ALTER TABLE "visit_requests"
  ADD COLUMN IF NOT EXISTS "contact_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'visit_requests'
      AND constraint_name = 'visit_requests_contact_id_leads_id_fk'
  ) THEN
    ALTER TABLE "visit_requests"
      ADD CONSTRAINT "visit_requests_contact_id_leads_id_fk"
      FOREIGN KEY ("contact_id") REFERENCES "leads"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "visit_requests_contact_idx"
  ON "visit_requests" USING btree ("contact_id");

-- -----------------------------------------------------------------------------
-- notes table
-- -----------------------------------------------------------------------------
--
-- Polymorphic over target_type:
--   'request' → target_id points at visit_requests.id
--   'contact' → target_id points at leads.id
--
-- We deliberately do NOT add an FK constraint on target_id — postgres
-- doesn't support polymorphic FKs cleanly, and the alternative (two
-- nullable FK columns + CHECK constraint) doubles read complexity for
-- limited safety win on an append-only table. Server actions validate
-- target existence before insert.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'note_target_type') THEN
    CREATE TYPE "note_target_type" AS ENUM ('request', 'contact');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notes" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  "target_type" "note_target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'notes'
      AND constraint_name = 'notes_created_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "notes"
      ADD CONSTRAINT "notes_created_by_user_id_users_id_fk"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- (target_type, target_id, created_at DESC) supports the timeline
-- retrieval pattern PR 2 / PR 3 will use. Index is btree; the DESC
-- direction lets `ORDER BY created_at DESC` use it without a sort.
CREATE INDEX IF NOT EXISTS "notes_target_timeline_idx"
  ON "notes" USING btree ("target_type", "target_id", "created_at" DESC);
