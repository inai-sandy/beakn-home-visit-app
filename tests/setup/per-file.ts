import { afterEach, vi } from 'vitest';

import { truncateAll } from '../helpers/db';

// HVA-143: route handlers call `revalidatePath('/', 'layout')` on
// their success paths. In production that runs inside Next.js's
// request context (set up by the framework around the route handler).
// Our route tests invoke the POST/PATCH/PUT functions directly, so
// that context is missing — `revalidatePath` throws
// "Invariant: static generation store missing".
//
// Mock it to a no-op globally. Test files that want to ASSERT
// revalidatePath was called (e.g. tests/api/revalidate-path.test.ts)
// override this with their own `vi.mock('next/cache', ...)` at the
// file level — vitest's file-level mock takes precedence over the
// setup-level one.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// proxy.ts captures NO_AUTH_PREFIXES + canAccess at module-load time on
// the value of NODE_ENV. Vitest defaults each worker to 'test'; force
// 'production' BEFORE proxy.ts is first imported so the production /dev/*
// gate logic is the one under test. Setting in globalSetup is too early
// (different worker); setting here runs once per worker, before the
// first test file is evaluated.
//
// The Record cast is purely a TypeScript ergonomics workaround:
// @types/node types process.env.NODE_ENV as readonly. At runtime it's
// just a JS object property; tests need to set it.
(process.env as Record<string, string>).NODE_ENV = 'production';

// =============================================================================
// HVA-101: per-test isolation via TRUNCATE
// =============================================================================
//
// Why TRUNCATE not transaction-rollback:
//   - Better-Auth's auth.api.* opens its own connections through the
//     Drizzle adapter. A test-level "wrap each test in a tx and rollback"
//     pattern requires the system under test to share the test's
//     transaction handle. BA doesn't expose that hook.
//   - TRUNCATE … RESTART IDENTITY CASCADE on every table is ~50ms total
//     for a schema this size — well under the cost of restarting the
//     container, and simple enough that test failures don't compound
//     across specs.
//   - Drizzle migration journal lives in schema "drizzle" — exempted
//     from the truncate so re-applying migrations is unnecessary.
//
// afterEach (not beforeEach): tests should set up their own fixtures
// at the start; clearing after means a failing test leaves the DB
// dirty for inspection, but the next test starts clean.
// =============================================================================

afterEach(async () => {
  await truncateAll();
});
