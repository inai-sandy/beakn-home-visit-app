import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// HVA-151 + HVA-198: Playwright config
// =============================================================================
//
// HVA-151 shipped one project (desktop Chromium at 1280×800) + 3 read-
// only smoke specs against the prod DB. HVA-198 extends to authenticated
// flows by switching to a testcontainer Postgres + a custom runner
// (`scripts/run-e2e.ts`) that owns the lifecycle.
//
// Why a runner instead of Playwright's built-in webServer:
// Playwright's webServer starts BEFORE globalSetup, which means a
// globalSetup that boots a testcontainer can't pass its connection
// string to the server. The runner script handles container + server
// + cleanup in order, then `exec playwright test` inherits the env.
//
// Three viewports per the HVA-198 acceptance criteria. Visual baselines
// per (project, spec) are stored under `tests/e2e/*.spec.ts-snapshots/`.
// =============================================================================

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Determinism > parallelism for visual baselines. A multi-worker run
  // can race-condition the webServer or capture mid-paint screenshots.
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
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        // Mobile chrome should be the closest match; using Desktop
        // Chrome viewport-resized to phone width gives consistent
        // screenshot fonts across runners and avoids Mobile Safari's
        // separate baseline tax.
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // NOTE: no `webServer` block. The runner script in scripts/run-e2e.ts
  // owns the container + server lifecycle and only invokes playwright
  // once the server is healthy. Running `playwright test` directly
  // (without the runner) requires DATABASE_URL pointing at a live DB
  // with seeded users.
});
