This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Running tests (HVA-101)

The harness uses [vitest](https://vitest.dev) + [@testcontainers/postgresql](https://node.testcontainers.org/modules/postgresql/) to spin an ephemeral Postgres container per `vitest run`, applies every migration in `db/migrations/` to it, and exposes the container's connection string as `DATABASE_URL` to the test process.

```bash
pnpm test               # one-shot run (CI-friendly)
pnpm test:watch         # interactive watch mode
pnpm test:coverage      # one-shot run + V8 coverage report
```

**Prerequisites:**
- Docker daemon reachable on the host. The first run pulls `postgres:16-alpine` (~80MB); subsequent runs reuse the image.
- No other prerequisites — no `.env.local`, no running app, no migrations to apply manually. The harness sets every env var it needs.

**Test layout:**
- `tests/setup/global.ts` — once per `vitest run`: boots the container + applies migrations + sets env.
- `tests/setup/per-file.ts` — once per worker: forces `NODE_ENV=production` so `proxy.ts` captures its prod branches at module load. `afterEach` truncates every test-mutable table (cities + status_stages stay seeded).
- `tests/helpers/db.ts` — `seedUser`, `seedSuperAdmin`, `seedCaptain`, `seedExecutive`, `seedVisitRequest`, `getOrCreateCity`, `getStatusStage`, `truncateAll`.
- `tests/helpers/auth.ts` — `loginByPhone(phone, password)` returning `{ userId, token, cookieHeader }` via Better-Auth's `auth.api.signInPhoneNumber`.

**Adding a test:** drop a file at `tests/<area>/<thing>.test.ts`. Import `db` from `@/db/client` and any system-under-test module directly — they pick up the testcontainer's DATABASE_URL via the shared globalSetup. The `afterEach` truncate isolates state.

**Isolation strategy:** truncate per-test (not per-suite transactions). Better-Auth opens its own connections through the Drizzle adapter, so a transaction-wrap-test pattern can't share the test's tx with BA. Truncating `users` would `CASCADE` through `cities.captain_user_id` and wipe the seed; we work around it with `DELETE FROM users` (honors `ON DELETE SET NULL`) after truncating every other table. ~50ms per test.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploying (Beakn VPS)

Production runs as a Docker container on a single VPS, behind a shared Caddy reverse proxy on `mcp-network`. The Postgres database lives in a sibling `beakn-postgres` container on the same network.

To deploy after merging to `main`:

```bash
cd /opt/beakn-home-visit-app
git checkout main && git pull
bash scripts/deploy.sh
```

The script:

1. Sources required `NEXT_PUBLIC_*` values from `.env.local`, refusing to proceed if any are missing or still hold the Dockerfile placeholder.
2. Runs `docker build` with the corresponding `--build-arg` flags so the values are baked into the client bundle at build time (Next.js inlines `process.env.NEXT_PUBLIC_*` references statically — runtime `--env-file` is too late for client code).
3. Verifies the built image actually carries the real values and no placeholder strings.
4. Runs `scripts/migrate.ts` against the live prod DB (using a host-side `DATABASE_URL` rewrite — `@beakn-postgres:` → `@127.0.0.1:`). Migrations run *before* the new container starts so the new code boots against a current schema. **If migration fails, the container is NOT restarted, so prod remains on the previous version.**
5. Stops + removes the old `beakn-app` container, runs a fresh one on `mcp-network` with `--env-file=.env.local`, and waits up to 30s for the healthcheck.

Adding a new `NEXT_PUBLIC_*` env var:

1. Add the corresponding `ARG NAME=build-time-placeholder-...` + `ENV NAME=$NAME` lines to the Dockerfile (matching the existing `NEXT_PUBLIC_TURNSTILE_SITE_KEY` pattern).
2. Add the name to `REQUIRED_BUILD_ARGS` in `scripts/deploy.sh`.
3. Set the real value in `.env.local` on the VPS.

Background: this script was added after the Turnstile outage of 2026-05-17, where five rebuilds in a row missed the `--build-arg` and baked the placeholder string into the client bundle. The customer form's CAPTCHA widget couldn't render until the next deploy script-ed rebuild. The fallback placeholder pattern in the Dockerfile is intentional — it keeps `next build` working locally + in CI without secrets — but production deploys must always go through this script.

## Deploy on Vercel (template default, unused — Beakn deploys via the VPS Docker path above)

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
