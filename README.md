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

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
