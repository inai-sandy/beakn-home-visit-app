-- HVA-222: status stages CRUD admin page
--
-- Two preparatory schema deltas so admin can edit the catalog without
-- shipping a redeploy:
--
--   1. ADD COLUMN is_terminal — explicit terminal flag. Today
--      terminality is derived as `seq = MAX(seq)`; an explicit flag lets
--      admin pin specific stages as terminal even if they shuffle
--      sequence_number around (e.g. "Cancelled" as terminal at
--      seq=99). Default false; backfilled true for the highest-seq
--      stage that exists at migration time (ORDER_EXECUTED_SUCCESSFULLY).
--
--   2. ADD COLUMN description — admin-facing prose explaining what the
--      stage means. NOT shown to execs / customers; just lives on the
--      admin page next to the label.
--
--   3. DROP UNIQUE INDEX status_stages_sequence_unique → replace with a
--      plain (non-unique) ORDER BY index. Reordering stages requires
--      the admin to set sequence_number freely; transient duplicates
--      during a multi-row swap shouldn't violate constraints. Code that
--      depends on stage identity uses `code` (which stays UNIQUE), not
--      sequence number, so duplicates don't break correctness.

ALTER TABLE status_stages
  ADD COLUMN is_terminal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE status_stages
  ADD COLUMN description TEXT;

-- Mark the highest-seq stage as terminal at migration time. This is
-- ORDER_EXECUTED_SUCCESSFULLY (seq=9) in the current seed, but the
-- query is sequence-agnostic so it survives reseeds with different
-- stage codes.
UPDATE status_stages
SET is_terminal = true
WHERE sequence_number = (SELECT MAX(sequence_number) FROM status_stages);

DROP INDEX IF EXISTS status_stages_sequence_unique;

CREATE INDEX IF NOT EXISTS status_stages_sequence_idx
  ON status_stages (sequence_number);
