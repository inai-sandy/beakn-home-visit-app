import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// =============================================================================
// HVA-101: vitest configuration
// =============================================================================
//
// Single-fork pool: the test harness shares one Postgres container across
// the whole run and clears state via TRUNCATE in afterEach. Running tests
// in parallel would race those truncates against each other's writes.
// fork-pool with maxForks=1 is the simplest way to enforce serial test
// execution without sacrificing test-file isolation (each spec file still
// gets its own module graph).
//
// Coverage: V8 provider, scoped to the three files this ship aims to
// cover. Repo-wide coverage will trend up issue by issue (HVA-109 is the
// next ship that broadens it).
// =============================================================================

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
          pool: 'forks',
          // @ts-expect-error vitest 4.1 type/runtime mismatch — poolOptions
          // is honored at runtime but not in the InlineConfig signature.
          poolOptions: {
            forks: { singleFork: true },
          },
          fileParallelism: false,
          globalSetup: ['./tests/setup/global.ts'],
          setupFiles: ['./tests/setup/per-file.ts'],
          include: ['tests/**/*.test.ts'],
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
