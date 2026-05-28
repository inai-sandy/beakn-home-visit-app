import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load .env.local so the webServer below can connect to the DB. Next.js
// loads this automatically when invoked through its own CLI, but the
// Playwright config runs in a plain Node context where we must do it
// explicitly. Otherwise webServer crashes with "EAI_AGAIN beakn-postgres"
// because DATABASE_URL is empty / unset.
dotenv.config({ path: '.env.local' });

// CLAUDE.md DATABASE_URL dual-form rule: `.env.local` stores the
// container-internal hostname (`beakn-postgres`) so the Docker app
// container can reach Postgres on its private network. When the e2e suite
// runs `pnpm next start` from the host, that hostname doesn't resolve —
// rewrite to `127.0.0.1:5432` (which is bound and exposed for host-side
// migrations + scripts). Pass-through if the URL is already host-form.
const liveDbUrl = process.env.DATABASE_URL ?? '';
const hostDbUrl = liveDbUrl.replace('@beakn-postgres:5432', '@127.0.0.1:5432');

// HVA-151: Playwright config — foundation phase.
//
// One project (desktop Chrome at 1280×800) for now. Additional viewports
// (mobile 375px, tablet 768px) get added once the desktop baseline is
// stable across a few PRs. Three viewports out of the gate triples the
// flake surface and inflates baseline storage 3x before we've proven the
// flow shape is right.
//
// The webServer runs `pnpm next start` on port 3100 (NOT 3000/3001 — those
// belong to the MCP stack + the prod beakn-app respectively). Production
// build mode is deterministic for screenshots; dev mode would let HMR +
// React DevTools overlays poison baseline diffs. First run does the build.
//
// reuseExistingServer in non-CI so developers can run tests against a
// prebuilt server in a separate terminal.

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Determinism > parallelism for visual baselines. A 4-worker run can
  // race-condition the webServer or capture mid-paint screenshots.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Block service worker registration so the SW's runtime cache doesn't
    // serve stale UI between tests.
    serviceWorkers: 'block',
  },
  expect: {
    // Tolerate sub-pixel font rendering jitter without losing the regressions
    // that matter. HVA-151 spec says "Diff >5% on any screenshot → CI fails".
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
    },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `pnpm next start -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL: hostDbUrl,
      // Distinct port + custom NODE_ENV stays at production (default for
      // `next start`) so we're testing the same code path users hit.
    } as Record<string, string>,
  },
});
