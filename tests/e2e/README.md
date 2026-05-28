# End-to-end tests (HVA-151)

Playwright-driven browser tests that catch the bug class vitest can't see:
FAB missing on a viewport, button hidden behind tab bar, RSC serialisation
errors that 500 only at runtime, navigation regressions, etc.

## Scope today (foundation)

- One project: desktop Chromium at 1280×800
- Three read-only smoke specs: `/login`, `/request`, 404 page
- No authentication required
- No visual baselines committed yet — assertion-based only

The full HVA-151 scope (3 critical flows × 3 viewports × visual baselines +
CI integration) lands in follow-up tickets. This PR ships the framework.

## Running locally

```bash
# Required once:
pnpm exec playwright install chromium

# Run the suite (does `pnpm next build` if there's no .next yet):
pnpm test:e2e

# Update visual baselines after a legitimate UI change:
pnpm test:e2e:update

# Open the Playwright UI / step debugger:
pnpm exec playwright test --ui
```

The webServer config starts `pnpm next start` on port 3100. If a previous
run left the server up, the next run reuses it (non-CI only).

## DB safety

These tests run against whatever database `.env.local` points the prod build
at. Today every spec is read-only — they hit public, unauthenticated routes.
**Do not add mutating tests** until we wire up an isolated test database
(separate follow-up). Mutations on the prod DB would corrupt live data.

## Adding a flow

1. Create `tests/e2e/<name>.spec.ts`
2. Mirror the structure of `smoke.spec.ts` (top-level `test.describe`)
3. Run `pnpm test:e2e` to confirm green
4. Commit. Baselines (if any) live next to the spec in `<name>.spec.ts-snapshots/`

## CI integration

Not wired into GitHub Actions yet. Tracked in a follow-up — adding a CI job
needs separate review of the existing workflow before bolting on a 5-10 min
browser step.
