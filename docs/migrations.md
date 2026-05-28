# Database migrations

## How it works

`db/migrations/` contains every SQL migration the project has shipped, named with a zero-padded sequence prefix (`0000_…`, `0001_…`, …). The `scripts/migrate.ts` runner is the single source of truth for applying them — replaces `drizzle-kit migrate`, which was retired in HVA-111.

The runner:

1. Lists every `db/migrations/*.sql` lexically.
2. Reads `drizzle.__drizzle_migrations` to find which hashes are already recorded.
3. For each unrecorded file: opens a transaction, executes the SQL, inserts a row with `sha256(file_bytes)` + a millisecond timestamp.
4. If a recorded file's current hash differs from its `__drizzle_migrations` row, aborts with a tamper error.

The same code path runs in three places:

| Where | Command |
| --- | --- |
| Local dev / prod deploy | `pnpm db:migrate` |
| HVA-101 vitest harness | `tests/setup/global.ts > applyMigrations(...)` (same SHA256-of-bytes + tracking-table flow, inlined) |
| Bootstrap / fresh DB | `pnpm db:migrate` against a clean Postgres |

## Adding a migration

1. Pick the next zero-padded sequence number.
2. Author the SQL by hand in `db/migrations/NNNN_<issue>_<short_description>.sql`. Use `IF NOT EXISTS` / `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` guards where appropriate so re-running on a partially-applied DB stays clean.
3. Run `pnpm db:migrate` locally against your dev DB. The runner will apply only the new file and record its hash.
4. Commit the `.sql` file. **Do not edit it after committing** — its hash is now load-bearing.
5. Schema changes? Update `db/schema/*.ts` to match (Drizzle ORM at runtime still reads these TS files). The TS files and the SQL must be kept in sync by hand — there's no auto-generator.

## Recovery from drift

Symptom — a developer's local DB shows a schema that doesn't match the `.sql` files:

- Run `pnpm db:migrate`. Any unapplied files run and record themselves.
- If a file's hash changed since it was applied, the runner fails with a tamper error. Either revert the file or apply the change as a NEW migration that fixes the in-place edit.

Symptom — a CI run shows `__drizzle_migrations` has rows whose hashes aren't in `db/migrations/`:

- A migration file was deleted. Either restore the file, or — if intentional — squash the missing row from the local DB and document the decision. Never delete rows on prod.

Symptom — fresh Postgres can't apply a migration because a prior one is broken:

- Fix the broken file (it hasn't been applied anywhere yet — it's safe to edit).

## Why not `drizzle-kit migrate`?

HVA-111 Phase 1 traced the divergence: `drizzle-kit migrate` consults `db/migrations/meta/_journal.json` to decide which files to apply. The team had been hand-authoring SQL for six consecutive ships (0006–0011) without running `drizzle-kit generate`, so `_journal.json` froze at idx 5. `drizzle-kit migrate` then silently skipped six real migrations on every fresh-DB run, while prod's `__drizzle_migrations` table happened to also stop at 6 rows. The schema was held together by manual force-applies + the HVA-101 harness's raw-SQL workaround.

Drizzle's `_journal.json` flow is also incompatible with the project's actual workflow: roughly half the migrations are pure `UPDATE` statements against the `config` table (audit allow-list extensions), which `drizzle-kit generate` literally can't produce — it diffs the TS schema, not the data. So the journal was effectively never going to keep up.

`scripts/migrate.ts` takes the folder as the source of truth and uses the same SHA256-of-bytes hash drizzle-kit 0.31 was producing for rows 0000–0005, so the existing prod rows stay format-identical and INSERT-only alignment for 0006–0011 was sufficient — no UPDATE / DELETE / hash-rewrite needed.

The Drizzle ORM (`drizzle-orm`, `db/schema/*.ts`) is unchanged. Only `drizzle-kit migrate` was replaced. `drizzle-kit studio` (the DB browser) and `drizzle-kit generate` (still callable via `pnpm db:migrate:legacy-drizzle-kit` for anyone curious) remain.

## Hash format

Every row in `drizzle.__drizzle_migrations` carries:

- `id` — `SERIAL`, auto-assigned
- `hash` — hex SHA-256 of the migration file's raw bytes (no whitespace normalization, no statement splitting)
- `created_at` — milliseconds since epoch, recorded at apply time

The prod hashes for 0000–0005 were originally written by `drizzle-kit migrate` in the v0.31 era. Phase 1 verified that `sha256(file_bytes)` reproduces every one of those hashes exactly, so `scripts/migrate.ts` continues the same format with no migration-of-the-migration table needed.

## Phase 1 / Phase 2 audit

- Phase 1 diagnosis (2026-05-17): Linear HVA-111 body, "AC compliance" section.
- Phase 2 alignment script ran once against prod to backfill 0006–0011 hashes (idempotent `WHERE NOT EXISTS`). Source file removed in HVA-193 (2026-05-28) — script lifecycle complete, kept here as historical note.
- Snapshot: `/tmp/prod-snapshot-pre-hva111.sql` (kept in `/tmp` for the duration of the ship; not committed).
