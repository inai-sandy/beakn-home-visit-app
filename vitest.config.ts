import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// =============================================================================
// HVA-101: vitest configuration
// =============================================================================
//
// PARALLEL node tests via per-worker databases:
//   globalSetup boots ONE Postgres container and migrates `beakn_test` as a
//   TEMPLATE. Each worker fork (tests/setup/per-worker-db.ts) clones that
//   template into its own `beakn_test_w<id>` DB and points DATABASE_URL at it,
//   so TRUNCATE-based isolation no longer races across files. This replaces
//   the old serial `singleFork: true` + `fileParallelism: false` setup.
//
//   maxForks is capped so total Postgres connections stay well under
//   max_connections=100: each worker's postgres-js pool is max 10, so
//   6 workers × 10 = 60, comfortably under 90.
//
// Coverage: V8 provider, scoped to the three files this ship aims to
// cover. Repo-wide coverage will trend up issue by issue (HVA-109 is the
// next ship that broadens it).
// =============================================================================

// Postgres max_connections=100; keep workers × ~10 conns well under 90.
const NODE_MAX_FORKS = Math.max(2, Math.min(os.cpus().length - 2, 6));

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: false,
    // HVA-138: split into two projects so component tests run in a real
    // browser (sidesteps Vite 8's dep-optimizer baking NODE_ENV=production
    // into react-dom/test-utils — the wall HVA-138 hit twice in jsdom mode).
    projects: [
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./', import.meta.url)),
          },
        },
        test: {
          name: 'node',
          globals: false,
          environment: 'node',
          // Parallel forks, one Postgres DB per worker (see per-worker-db.ts).
          pool: 'forks',
          // @ts-expect-error vitest 4.1 type/runtime mismatch — maxForks/
          // minForks are honored at runtime for the forks pool but are not on
          // the per-project ProjectConfig signature (same shape as the old
          // poolOptions mismatch this replaced).
          maxForks: NODE_MAX_FORKS,
          minForks: 1,
          globalSetup: ['./tests/setup/global.ts'],
          // per-worker-db.ts MUST run before per-file.ts: it clones this
          // worker's DB and sets DATABASE_URL before any db.* access (the
          // afterEach truncate in per-file.ts touches the DB).
          setupFiles: ['./tests/setup/per-worker-db.ts', './tests/setup/per-file.ts'],
          include: ['tests/**/*.test.ts'],
          // HVA-138-FIX2: hard-exclude component tests from the node
          // project. Vitest's default extension match catches .tsx
          // alongside .ts, so without this the node project would try
          // to run advance-status-button.test.tsx via jsdom (which is
          // exactly the dep-optimizer wall HVA-138 was designed to
          // sidestep). Belt-and-suspenders alongside the explicit
          // 'tests/**/*.test.ts' include.
          exclude: ['tests/components/**', 'tests/e2e/**', '**/node_modules/**'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./', import.meta.url)),
          },
        },
        // next/* modules read process.env at module-load time; the browser
        // doesn't have a global `process`. Polyfilling at the vite layer
        // makes the transitive imports tolerate this without per-test mocks.
        define: {
          'process.env.NODE_ENV': '"test"',
          'process.env': '{}',
        },
        test: {
          name: 'browser',
          globals: false,
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['./tests/setup/browser.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        // HVA-101 originals
        'proxy.ts',
        'lib/status-transition.ts',
        'app/set-password/actions.ts',
        // HVA-109 retroactive coverage targets
        'app/api/customer-request/route.ts',
        'app/api/requests/[id]/assign/route.ts',
        'app/api/admin/captains/[id]/deactivate/route.ts',
        'app/api/admin/captains/[id]/activate/route.ts',
        'app/api/admin/executives/[id]/deactivate/route.ts',
        'lib/notifications/email-handlers/captain-new-request.ts',
        // HVA-68 coverage target
        'app/api/requests/[id]/mark-installation-complete/route.ts',
        // HVA-69 coverage target
        'app/api/requests/[id]/mark-customer-rejected/route.ts',
        // HVA-66 coverage target — page-level helpers
        'lib/request-detail.ts',
      ],
      reportOnFailure: true,
    },
  },
});
