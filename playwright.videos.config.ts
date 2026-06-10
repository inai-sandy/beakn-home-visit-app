import { defineConfig, devices } from '@playwright/test';

// =============================================================================
// HVA-262: VIDEO RECORDING config — walkthrough clips for the exec manual
// =============================================================================
//
// NOT part of CI. The default `pnpm test:e2e` uses playwright.config.ts
// (testDir tests/e2e) and never sees this. To record:
//
//   pnpm test:e2e --config=playwright.videos.config.ts
//
// The run-e2e runner still owns the lifecycle (testcontainer + seed +
// server on :3100) and forwards the --config flag to `playwright test`.
//
// Design choices for HUMAN-WATCHABLE clips:
//   - Phone-ish portrait viewport (390×844) — matches how execs hold it
//   - slowMo 600ms — every click visibly lands before the next
//   - video.size pinned to the viewport so nothing is scaled/cropped
//   - workers 1 + fullyParallel false — one clean recording at a time
// =============================================================================

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/videos',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: 'test-results/videos',
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    video: { mode: 'on', size: { width: 390, height: 844 } },
    launchOptions: { slowMo: 600 },
  },
  projects: [
    {
      name: 'video',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});
