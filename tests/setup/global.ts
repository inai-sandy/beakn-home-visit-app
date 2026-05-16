import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

// =============================================================================
// HVA-101: vitest globalSetup — one Postgres testcontainer per `vitest run`
// =============================================================================
//
// What this does:
//   1. Boot a fresh `postgres:16-alpine` container with a random host port.
//   2. Apply uuidv7 + every .sql file under db/migrations/ in lexical order
//      to that container.
//   3. Expose the container's connection string as DATABASE_URL + the test-
//      specific BETTER_AUTH_SECRET on process.env so lib/auth.ts and
//      db/client.ts pick them up on first import.
//   4. Returns a teardown function vitest invokes after the run.
//
// Why no drizzle-kit migrate(): drizzle-kit's programmatic migrator wants
// a meta/_journal.json that lives in db/migrations/meta — but the journal
// references hashes that depend on the original generation env. We bypass
// it by applying the .sql files directly. The migrations themselves are
// idempotent ('IF NOT EXISTS' / 'ON CONFLICT DO NOTHING' patterns) so
// re-applying in a fresh DB is straightforward.
//
// Cold-start budget: ~6-10s on the VPS (image pull is cached; container
// boot + migrations ~5s).
// =============================================================================

declare global {
  var __TEST_PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function applyMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    // Migrations reference uuid_generate_v7(). The initial schema migration
    // creates it, but only if pgcrypto / the helper is present. Install
    // pgcrypto upfront so every migration file's CREATE TABLE … DEFAULT
    // uuid_generate_v7() resolves.
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto;');

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const path = join(MIGRATIONS_DIR, file);
      const body = readFileSync(path, 'utf8');
      if (body.trim().length === 0) continue;
      try {
        await sql.unsafe(body);
      } catch (err) {
        const e = err as Error;
        throw new Error(`migration ${file} failed: ${e.message}`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function setup(): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('beakn_test')
    .withUsername('beakn_test')
    .withPassword('beakn_test_pw')
    .withReuse() // reuse across consecutive `vitest run` invocations in the same dev session
    .start();

  globalThis.__TEST_PG_CONTAINER__ = container;

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  // Better-Auth requires this at module load. Length matches the prod
  // shape (32-byte hex) but is throwaway — the value is meaningless
  // outside this test run.
  process.env.BETTER_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET ?? 'a'.repeat(64);
  process.env.BETTER_AUTH_URL =
    process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
  // Turnstile bypass — tests don't exercise the customer-form path that
  // gates on it, but other modules import lib/turnstile transitively and
  // we keep the env shape complete.
  process.env.TURNSTILE_SECRET_KEY =
    process.env.TURNSTILE_SECRET_KEY ?? '1x0000000000000000000000000000000AA';
  // NODE_ENV='production' on purpose: proxy.ts captures NO_AUTH_PREFIXES at
  // module load time, branching on this env. Tests that exercise the
  // /dev/* prod gate need the production branch active when proxy.ts is
  // first imported. No other tested module changes behavior on this flag.
  // The cast is a TypeScript ergonomics workaround (NODE_ENV typed readonly).
  (process.env as Record<string, string>).NODE_ENV = 'production';

  await applyMigrations(url);

  return async () => {
    if (globalThis.__TEST_PG_CONTAINER__) {
      await globalThis.__TEST_PG_CONTAINER__.stop({ timeout: 5_000 });
      globalThis.__TEST_PG_CONTAINER__ = undefined;
    }
  };
}
