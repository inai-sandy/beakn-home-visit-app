-- HVA-228: warnings — soft + hard performance warnings issued by admin
--
-- Per-issuance row, no deletes (revoked_at + revoked_by are the soft-
-- revoke fields). Counts derived via `WHERE revoked_at IS NULL`. The
-- `message_snapshot` column stores the fully-rendered text at issue
-- time so the audit + history remain stable across template edits.

CREATE TABLE IF NOT EXISTS warnings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  exec_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind                VARCHAR(8)  NOT NULL CHECK (kind IN ('soft', 'hard')),
  metric_code         VARCHAR(32) NOT NULL,
  period_label        VARCHAR(64) NOT NULL,
  current_value       BIGINT      NOT NULL,
  target_value        BIGINT      NOT NULL,
  reason              TEXT        NOT NULL,
  message_snapshot    TEXT        NOT NULL,
  issued_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at          TIMESTAMPTZ,
  revoked_by_user_id  UUID REFERENCES users(id) ON DELETE RESTRICT,
  revoked_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS warnings_exec_revoked_idx
  ON warnings (exec_user_id, revoked_at);

CREATE INDEX IF NOT EXISTS warnings_kind_idx
  ON warnings (kind);

CREATE INDEX IF NOT EXISTS warnings_created_at_idx
  ON warnings (created_at);
