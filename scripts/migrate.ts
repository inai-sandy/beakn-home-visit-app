// =============================================================================
// HVA-111: hand-authored-SQL migration runner
// =============================================================================
//
// Replaces `drizzle-kit migrate` for production + CI. The Drizzle ORM
// (runtime + db/schema/*.ts) is untouched — only the migration tool
// changes. This runner:
//
//   1. Lists every db/migrations/*.sql lexically.
//   2. Reads applied state from `drizzle.__drizzle_migrations` — the
//      same table drizzle-kit was writing into. We INSERT-only.
//   3. For each unapplied file: runs the SQL in a transaction, then
//      INSERTs a row with sha256(file bytes) + ms-since-epoch.
//   4. If a file's recorded hash differs from its current sha256,
//      aborts with a tampering error (the file changed since it was
//      applied — re-running could be destructive).
//
// Hash format: raw SHA256 of the file's bytes. Verified during the
// HVA-111 Phase 1 diagnostic that drizzle-kit 0.31 used exactly this
// format for the first 6 entries on prod, so this runner stays
// compatible with the existing rows.
//
// Why not the journal file: `db/migrations/meta/_journal.json` was the
// source of every divergence Phase 1 surfaced. The folder itself is
// the source of truth from this point forward.
//
// Why reuse `drizzle.__drizzle_migrations`: it's already there, prod's
// 6 rows match the format perfectly, and INSERT-only alignment keeps
// the existing audit trail intact. A parallel `applied_migrations`
// table would be cleaner cosmetically but doubles the surface area.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

interface MigrationFile {
  filename: string;
  hash: string;
  body: string;
}

function listMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const path = join(MIGRATIONS_DIR, filename);
      const body = readFileSync(path, 'utf8');
      const hash = createHash('sha256').update(body).digest('hex');
      return { filename: basename(filename), hash, body };
    });
}

async function ensureTable(sql: postgres.Sql): Promise<void> {
  // Matches drizzle-kit's schema for backward compat with rows 1–6.
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    );
  `);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const files = listMigrations();
  if (files.length === 0) {
    console.log('[migrate] no .sql files in db/migrations/');
    return;
  }

  // `onnotice: () => {}` silences harmless Postgres NOTICEs from
  // `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` on
  // re-runs. They're not errors; postgres-js's default is to print them.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await ensureTable(sql);

    const recorded = await sql<{ hash: string }[]>`
      SELECT hash FROM drizzle.__drizzle_migrations
    `;
    const recordedSet = new Set(recorded.map((r) => r.hash));

    // Tampering check: any file whose name implies "already applied"
    // (lex-prior to the first unapplied file) but whose current hash is
    // missing from the table is a contradiction. The runner can't tell
    // for certain without an explicit filename column, so we only flag
    // when a file's hash isn't recorded yet but a strictly-lex-later
    // file's hash IS recorded — that's the only ambiguity-free signal
    // a file was rewritten in place.
    for (let i = 0; i < files.length - 1; i++) {
      const here = files[i];
      const next = files[i + 1];
      if (!recordedSet.has(here.hash) && recordedSet.has(next.hash)) {
        throw new Error(
          `[migrate] tamper check failed: ${here.filename} hash ${here.hash} not in __drizzle_migrations, but the later file ${next.filename} IS recorded. The earlier file appears to have been modified after it was applied.`,
        );
      }
    }

    let applied = 0;
    let skipped = 0;
    const nowMs = () => Date.now();
    for (const file of files) {
      if (recordedSet.has(file.hash)) {
        skipped += 1;
        continue;
      }
      console.log(`[migrate] applying ${file.filename}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(file.body);
        await tx`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${file.hash}, ${nowMs()})
        `;
      });
      applied += 1;
    }

    console.log(
      `[migrate] done. applied=${applied} skipped=${skipped} total_files=${files.length}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[migrate] FAILED: ${msg}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });
