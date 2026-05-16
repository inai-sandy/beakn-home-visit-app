import { fileURLToPath } from 'node:url';
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
    environment: 'node',
    pool: 'forks',
    // singleFork forces all tests to share one worker so they serialize
    // against the same Postgres container without racing truncates.
    // (The vitest 4 runtime warning suggests moving these to top-level,
    // but the vitest/config defineConfig signature doesn't expose
    // poolOptions in 4.1.x — works at runtime, ts-expect-error documents
    // the mismatch until the types catch up.)
    // @ts-expect-error vitest 4.1 type/runtime mismatch — poolOptions is
    // honored at runtime but not in the InlineConfig signature.
    poolOptions: {
      forks: { singleFork: true },
    },
    // fileParallelism: false makes vitest run test FILES sequentially
    // within that single fork. Without this, multiple test files run
    // concurrently and race against truncateAll() between tests — manifests
    // as PG deadlocks + FK violations.
    fileParallelism: false,
    globalSetup: ['./tests/setup/global.ts'],
    setupFiles: ['./tests/setup/per-file.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
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
