import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres from 'postgres';

// =============================================================================
// HVA-198: shared testcontainer boot for Playwright e2e
// =============================================================================
//
// Reuses the same SHA256-tracked migration logic vitest uses in
// tests/setup/global.ts. Extracted here so both runners can share the
// boot path:
//   - vitest's globalSetup spins up its own container per `vitest run`
//   - the Playwright runner (scripts/run-e2e.ts) spins up its own
//     container per `pnpm test:e2e`
//
// Returns the running container + its host-form connection URL.
// =============================================================================

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function applyMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS drizzle;
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      );
    `);
    const recorded = await sql<{ hash: string }[]>`
      SELECT hash FROM drizzle.__drizzle_migrations
    `;
    const recordedSet = new Set(recorded.map((r) => r.hash));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const path = join(MIGRATIONS_DIR, file);
      const body = readFileSync(path, 'utf8');
      if (body.trim().length === 0) continue;
      const hash = createHash('sha256').update(body).digest('hex');
      if (recordedSet.has(hash)) continue;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${Date.now()})
          `;
        });
      } catch (err) {
        const e = err as Error;
        throw new Error(`migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export interface BootedTestPg {
  container: StartedPostgreSqlContainer;
  url: string;
}

export async function bootTestPostgres(): Promise<BootedTestPg> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('beakn_e2e')
    .withUsername('beakn_e2e')
    .withPassword('beakn_e2e_pw')
    // No .withReuse() here — Playwright runs end-to-end, snapshots are
    // sensitive to stale state; fresh container every run.
    .start();

  const url = container.getConnectionUri();
  await applyMigrations(url);
  return { container, url };
}
