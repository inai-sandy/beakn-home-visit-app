import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import { bootTestPostgres } from '../tests/setup/e2e-boot';
import { seedE2EUsers } from '../tests/setup/e2e-seed';

// =============================================================================
// HVA-198: Playwright e2e runner — orchestrates container + server + tests
// =============================================================================
//
// Playwright's built-in webServer config starts BEFORE globalSetup, so it
// can't see env vars mutated in globalSetup. That makes the testcontainer-
// per-run pattern incompatible with the built-in webServer.
//
// Workaround: this script owns the lifecycle. It boots a fresh Postgres
// testcontainer, seeds the canonical e2e users, builds (or reuses) the
// Next.js production bundle, spawns `next start -p 3100` with the
// testcontainer URL in env, polls /api/health until ready, then invokes
// `playwright test` with the rest of process.argv. On exit it kills the
// next-start child and stops the container.
//
// Usage:
//   pnpm test:e2e                       # full run
//   pnpm test:e2e --grep exec-daily     # focused
//   pnpm test:e2e:update                # update snapshots
//
// The runner exits with the playwright exit code so CI gating works.
// =============================================================================

const PORT = 3100;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const PLAYWRIGHT_E2E_FILE = join(process.cwd(), 'tests', 'e2e', '.e2e-users.json');

let nextProc: ChildProcess | null = null;
let containerStopper: (() => Promise<void>) | null = null;

async function pollHealth(maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'ok') return true;
      }
    } catch {
      // Server not ready yet — keep polling.
    }
    await wait(500);
  }
  return false;
}

async function cleanup(): Promise<void> {
  if (nextProc) {
    try {
      nextProc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          nextProc?.kill('SIGKILL');
          resolve();
        }, 5_000);
        nextProc?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch {
      // best-effort
    }
    nextProc = null;
  }
  if (containerStopper) {
    try {
      await containerStopper();
    } catch {
      // best-effort
    }
    containerStopper = null;
  }
}

async function main() {
  // Make sure the production build exists. `next start` errors loudly
  // otherwise. Skip the build if .next/standalone is already present
  // (developer fast-iteration mode).
  if (!existsSync(join(process.cwd(), '.next', 'BUILD_ID'))) {
    console.log('[e2e] no .next build found — running `pnpm next build`…');
    const buildResult = spawnSync('pnpm', ['next', 'build'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        // Provide dummy values so build-time imports of auth.ts +
        // db/client.ts don't crash. These are overridden at runtime
        // when next start sees the real env.
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgres://build:build@localhost:5432/build',
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ?? 'a'.repeat(64),
      },
    });
    if (buildResult.status !== 0) {
      console.error('[e2e] next build failed');
      process.exit(1);
    }
  }

  console.log('[e2e] booting testcontainer Postgres…');
  const { container, url } = await bootTestPostgres();
  containerStopper = async () => {
    await container.stop({ timeout: 5_000 });
  };
  console.log(`[e2e] postgres up at ${url}`);

  console.log('[e2e] seeding users…');
  const seeded = await seedE2EUsers(url);
  // Write the seed details so individual specs can read phone+password
  // without re-deriving them.
  writeFileSync(PLAYWRIGHT_E2E_FILE, JSON.stringify(seeded, null, 2));
  console.log(
    `[e2e] seeded exec=${seeded.exec.phone}, captain=${seeded.captain.phone}, admin=${seeded.superAdmin.phone}`,
  );

  console.log(`[e2e] starting next on :${PORT}…`);
  nextProc = spawn('pnpm', ['next', 'start', '-p', String(PORT)], {
    env: {
      ...process.env,
      DATABASE_URL: url,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? 'a'.repeat(64),
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      TURNSTILE_SECRET_KEY:
        process.env.TURNSTILE_SECRET_KEY ??
        '1x0000000000000000000000000000000AA',
      // Production node env — same code path users hit. proxy.ts gates
      // /dev/* on this.
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  nextProc.stdout?.on('data', (d) => {
    process.stderr.write(`[next] ${d.toString()}`);
  });
  nextProc.stderr?.on('data', (d) => {
    process.stderr.write(`[next] ${d.toString()}`);
  });
  nextProc.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e] next exited unexpectedly with code ${code}`);
    }
  });

  console.log('[e2e] waiting for /api/health…');
  const healthy = await pollHealth(60_000);
  if (!healthy) {
    console.error('[e2e] server did not become healthy in 60s');
    await cleanup();
    process.exit(1);
  }
  console.log('[e2e] server healthy — running playwright');

  const pwArgs = process.argv.slice(2);
  const pw = spawn('pnpm', ['exec', 'playwright', 'test', ...pwArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Specs can read this file to discover seeded credentials.
      E2E_USERS_FILE: PLAYWRIGHT_E2E_FILE,
      // Per-test DB helpers (e.g. tests/e2e/helpers/db-reset.ts)
      // connect to the same testcontainer as the running next-server.
      DATABASE_URL: url,
    },
  });

  const exitCode: number = await new Promise((resolve) => {
    pw.once('exit', (code) => resolve(code ?? 1));
  });

  await cleanup();
  process.exit(exitCode);
}

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});
process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143);
});

main().catch(async (err) => {
  console.error('[e2e] runner failed:', err);
  await cleanup();
  process.exit(1);
});
