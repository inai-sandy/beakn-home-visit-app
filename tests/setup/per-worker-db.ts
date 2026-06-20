import postgres from 'postgres';

// =============================================================================
// Per-worker database isolation (parallel test execution)
// =============================================================================
//
// globalSetup (tests/setup/global.ts) boots ONE postgres container and migrates
// `beakn_test` as a TEMPLATE. To let the suite run in parallel without workers
// racing each other's TRUNCATEs on a shared DB, each vitest worker fork gets its
// OWN database cloned from that template:
//
//     CREATE DATABASE beakn_test_w<id> TEMPLATE beakn_test
//
// and then points DATABASE_URL at it. Because db/client.ts memoizes the
// postgres-js connection lazily on the FIRST `db.*` access (per-process /
// per-fork globalThis), setting DATABASE_URL here — at the top of a setupFile
// that runs BEFORE the first test and BEFORE per-file.ts — guarantees every
// `db.*` call in this worker hits the worker-private DB.
//
// This module performs its work via a top-level await so the clone is complete
// before vitest evaluates any test file in the worker.
// =============================================================================

const adminUrl = process.env.TEST_PG_ADMIN_URL;
const templateDb = process.env.TEST_PG_TEMPLATE_DB ?? 'beakn_test';

if (!adminUrl) {
  throw new Error(
    'TEST_PG_ADMIN_URL not set — globalSetup (tests/setup/global.ts) must run first.',
  );
}

// Vitest assigns each worker a stable id. VITEST_WORKER_ID is the canonical one;
// VITEST_POOL_ID is the fallback. Default to '1' if neither is present (e.g.
// single-fork local runs).
const workerId =
  process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? '1';
const workerDb = `beakn_test_w${workerId}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dbExists(admin: ReturnType<typeof postgres>): Promise<boolean> {
  const rows = await admin<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_database WHERE datname = ${workerDb}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

// Shared cluster-wide advisory-lock key. All workers serialize their
// CREATE DATABASE … TEMPLATE on this so the clones run one-at-a-time instead of
// as a simultaneous storm. A simultaneous storm saturates the small test
// Postgres (every clone byte-copies the migrated schema) and makes the FIRST
// connection of every other worker's pool exceed connect_timeout → the
// CONNECT_TIMEOUT flake we saw. Serialized, each clone finishes in ~1-2s and the
// server stays responsive throughout.
const CLONE_LOCK_KEY = 778899;

async function ensureWorkerDb(): Promise<void> {
  // A fresh admin connection is opened per attempt (generous connect_timeout)
  // so a dropped/timed-out socket never poisons subsequent retries.
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const admin = postgres(adminUrl as string, {
      max: 1,
      onnotice: () => {},
      connect_timeout: 60,
      idle_timeout: 5,
    });
    try {
      // Idempotent across file reuse within a worker: a single worker fork runs
      // many test files sequentially, re-evaluating this setupFile each time.
      // The post-condition is strict: this function only returns once the DB is
      // confirmed to exist (verified inside the advisory lock), so callers can
      // rely on it never returning with the clone absent.
      if (await dbExists(admin)) return;

      // Serialize the actual clone behind a cluster-wide advisory lock so only
      // one CREATE DATABASE runs at a time across all workers.
      await admin.unsafe(`SELECT pg_advisory_lock(${CLONE_LOCK_KEY});`);
      try {
        if (await dbExists(admin)) return; // created while we waited for the lock
        try {
          await admin.unsafe(
            `CREATE DATABASE "${workerDb}" TEMPLATE "${templateDb}";`,
          );
        } catch (err) {
          const msg = (err as Error).message ?? '';
          // "already exists" is only safe to treat as success if the DB really
          // is there now — verify rather than assume.
          if (!(msg.includes('already exists') || msg.includes('duplicate_database'))) {
            throw err;
          }
        }
        // Post-condition: confirm the DB is actually present before returning.
        if (await dbExists(admin)) return;
        if (attempt === maxAttempts) {
          throw new Error(
            `worker DB "${workerDb}" missing after CREATE attempt ${attempt}`,
          );
        }
        await sleep(200 * attempt + Math.floor(Math.random() * 200));
      } finally {
        try {
          await admin.unsafe(`SELECT pg_advisory_unlock(${CLONE_LOCK_KEY});`);
        } catch {
          // lock auto-releases when this admin connection closes
        }
      }
    } catch (err) {
      // A connect-level failure (CONNECT_TIMEOUT/ECONNREFUSED) before/around the
      // queries lands here. Retry with a fresh connection unless we're out of
      // attempts.
      if (attempt === maxAttempts) throw err;
      await sleep(200 * attempt + Math.floor(Math.random() * 200));
    } finally {
      try {
        await admin.end({ timeout: 5 });
      } catch {
        // ignore
      }
    }
  }
}

// Warm the worker DB connection before any test runs, using a dedicated
// generous-timeout client (NOT the production `db` pool, whose connect_timeout
// is a tight 10s). This proves the worker DB is reachable and primes Postgres
// so the first real `db.*` access connects promptly even under load.
async function warmWorkerDb(workerDbUrl: string): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const c = postgres(workerDbUrl, {
      max: 1,
      onnotice: () => {},
      connect_timeout: 60,
      idle_timeout: 2,
    });
    try {
      await c`SELECT 1`;
      return;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // Self-heal: if the worker DB is reported missing, (re)create it. This
      // covers the rare race where ensureWorkerDb's idempotent existence check
      // saw a stale/partial state, or a concurrent operation left the clone
      // absent. Re-running ensureWorkerDb is safe (it no-ops if present).
      if (/does not exist/i.test(msg)) {
        try {
          await c.end({ timeout: 5 });
        } catch {
          // ignore
        }
        await ensureWorkerDb();
        await sleep(100 + Math.floor(Math.random() * 200));
        continue;
      }
      if (attempt === maxAttempts) throw err;
      await sleep(200 * attempt + Math.floor(Math.random() * 200));
    } finally {
      try {
        await c.end({ timeout: 5 });
      } catch {
        // ignore
      }
    }
  }
}

await ensureWorkerDb();

// Point this worker's DATABASE_URL at its private clone. db/client.ts reads
// this on first `db.*` access.
const workerUrl = new URL(adminUrl as string);
workerUrl.pathname = `/${workerDb}`;
process.env.DATABASE_URL = workerUrl.toString();

// Prove the worker DB is reachable (generous-timeout client) before any test —
// primes the connection so the first real db.* access connects promptly even
// while the cluster is still under load from other workers' clones.
await warmWorkerDb(workerUrl.toString());

// -----------------------------------------------------------------------------
// One-time-per-worker baseline truncate
// -----------------------------------------------------------------------------
//
// The cloned template carries the migration-seeded rows of the *mutable*
// tables that truncateAll() clears between tests (notably `notification_rules`,
// seeded by migrations 0012/0048/0066/…). Under the OLD serial run those seeds
// were wiped by the very first test's afterEach and never came back, so every
// subsequent test effectively ran against an empty `notification_rules`. Tests
// were written against that post-truncate state — e.g.
// tests/notifications/engine.test.ts inserts its OWN rules and would collide on
// the unique (event_type, channel, recipient_role) index if the seeded rows
// were still present.
//
// Each worker now starts from a FRESH clone, so without this the seeds would be
// present for whichever file runs first in each worker — a spurious
// unique-violation that only appears in parallel. Running truncateAll() exactly
// once per worker (before the first test file) reproduces the serial
// precondition for ALL files. Tests that genuinely need the seeded rows
// (e.g. tests/support/dispatch-notifications.test.ts) re-seed them in their own
// beforeEach, so this is behaviour-preserving.
//
// Guarded on globalThis (persists across files within a single fork) so it runs
// once per worker, not once per file.
declare global {
  // eslint-disable-next-line no-var
  var __BEAKN_WORKER_DB_BASELINED__: boolean | undefined;
}
// __beakn_pg__ / __beakn_db__ are declared globally by db/client.ts (imported
// transitively via helpers/db). We reset them between connect retries below.

if (!globalThis.__BEAKN_WORKER_DB_BASELINED__) {
  const { truncateAll } = await import('../helpers/db');

  // At worker startup all forks open their first DB connection at nearly the
  // same time, on top of the CREATE DATABASE … TEMPLATE clone storm. That can
  // momentarily saturate Postgres and make the very first connect exceed the
  // postgres-js connect_timeout (db/client.ts: 10s), surfacing as
  // CONNECT_TIMEOUT. It's transient — retry the first DB access (the baseline
  // truncate) a few times, resetting the memoized pool between attempts so each
  // retry establishes a fresh connection.
  const isTransientConnError = (err: unknown): boolean => {
    const e = err as { code?: string; message?: string };
    const code = e?.code ?? '';
    const msg = e?.message ?? '';
    return (
      code === 'CONNECT_TIMEOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'CONNECTION_DESTROYED' ||
      /CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|connection|terminat/i.test(msg)
    );
  };

  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await truncateAll();
      break;
    } catch (err) {
      if (attempt === maxAttempts || !isTransientConnError(err)) throw err;
      // Drop the memoized postgres-js pool so the next attempt reconnects
      // fresh once the startup storm has subsided.
      try {
        await globalThis.__beakn_pg__?.end({ timeout: 5 });
      } catch {
        // ignore
      }
      globalThis.__beakn_pg__ = undefined;
      globalThis.__beakn_db__ = undefined;
      await sleep(300 * attempt + Math.floor(Math.random() * 200));
    }
  }

  globalThis.__BEAKN_WORKER_DB_BASELINED__ = true;
}
