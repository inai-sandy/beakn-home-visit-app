# Beakn Home Visit App — Docker runtime

The Next.js app ships as a single Docker image (`beakn-app:latest`) running on
the shared `mcp-network`. Caddy (also on `mcp-network`) reverse-proxies
`visits.beakn.in → beakn-app:3001`.

## File map
- [`/Dockerfile`](../../Dockerfile) — multi-stage build (deps → build → runtime), Node 22 Alpine, pnpm via corepack, runs as non-root `nextjs` UID 1001, HEALTHCHECK polls `/api/health`.
- [`/.dockerignore`](../../.dockerignore) — keeps secrets and dev tooling out of the image.
- [`/next.config.ts`](../../next.config.ts) — `output: "standalone"` emits a self-contained server bundle at `.next/standalone/server.js`.
- [`/app/api/health/route.ts`](../../app/api/health/route.ts) — the endpoint Docker's HEALTHCHECK polls.

## Port deviation

**HVA-16 AC says port 3000, we use 3001 because `dataforseo-mcp` owns 3000 on this VPS. Caddy reverse-proxies `visits.beakn.in` to `beakn-app:3001`.** Inside the container the app listens on 3001 (set via `PORT=3001` in the Dockerfile); nothing is published to the host.

## Health endpoint

`GET /api/health` (server route, Node runtime, `force-dynamic`):

| Outcome | Response |
|---|---|
| DB SELECT 1 succeeds | `200` `{ status: "ok", db: "connected", timestamp }` |
| DB query fails (timeout, refused, auth, etc.) | `503` `{ status: "degraded", db: "unreachable", error, timestamp }` |

Cheap to call — single round-trip, no aggregations. Safe for monitoring at any cadence above the Docker healthcheck's 30 s.

The Dockerfile's `HEALTHCHECK` directive polls it from inside the container:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1
```

`127.0.0.1` instead of `localhost` is deliberate — Alpine's resolver returns IPv6 `[::1]` first for `localhost`, and Next.js's standalone server binds to IPv4 `0.0.0.0` only. Using the literal IPv4 address avoids a needless v6/v4 mismatch.

So: every 30 s, with a 3 s timeout per poll, mark unhealthy after 3 consecutive failures, give the container 10 s to boot before failures count. Observe via `docker ps` (STATUS column shows `(healthy)`/`(unhealthy)`) or `docker inspect --format '{{.State.Health.Status}}' beakn-app`.

## First-time bring-up

```bash
# 1. Build (from repo root)
docker build -t beakn-app:latest .

# 2. Smoke test on an alternate host port (no Caddy involvement)
docker run --rm \
  --name beakn-app-test \
  --network mcp-network \
  --env-file .env.local \
  -p 3002:3001 \
  beakn-app:latest
# In another shell:
curl -I http://localhost:3002/

# 3. Start the production container (long-lived, no host port — only mcp-network)
docker run -d \
  --name beakn-app \
  --network mcp-network \
  --env-file .env.local \
  --restart unless-stopped \
  beakn-app:latest
```

## Day-to-day operations

| Action | Command |
|---|---|
| Tail logs | `docker logs -f beakn-app` |
| Restart | `docker restart beakn-app` |
| Stop | `docker stop beakn-app` |
| Remove | `docker rm -f beakn-app` |
| Open a shell | `docker exec -it beakn-app sh` |
| Check it's reachable from Caddy | `docker exec caddy wget -qO- http://beakn-app:3001/` |

## Rebuild after code changes

```bash
docker build -t beakn-app:latest .
docker stop beakn-app && docker rm beakn-app
docker run -d \
  --name beakn-app \
  --network mcp-network \
  --env-file .env.local \
  --restart unless-stopped \
  beakn-app:latest
```

There is no rolling-deploy yet — short downtime (a few seconds) during the swap. A future issue will replace this with a zero-downtime cutover (Portainer rolling-update, blue/green, or compose stack).

## Environment variables

The container reads its env from `--env-file .env.local` at runtime. The file
lives at `/opt/beakn-home-visit-app/.env.local` on the VPS (gitignored, owned
by `beakn`).

Required keys today:
- `DATABASE_URL` — must use `beakn-postgres:5432` as the host (not `127.0.0.1` or `localhost`) since both containers are on `mcp-network` and resolve each other by container name. Example:
  ```
  DATABASE_URL=postgresql://beakn_app:<password>@beakn-postgres:5432/beakn_app
  ```

When HVA-24 (Better-Auth) lands, add `BETTER_AUTH_SECRET` and friends to
`.env.local`; no Dockerfile change needed — they flow through `--env-file`.

## Why standalone mode

`output: "standalone"` makes Next.js write `.next/standalone/server.js` plus the
exact subset of `node_modules` it traced — no `pnpm install` at runtime, no
unused dev deps in the image. The runtime stage starts at `~150 MB` instead of
`~800 MB` (`pnpm install` in the image).

## Caddy upstream

The Caddyfile entry for `visits.beakn.in` points to `beakn-app:3001`. See
[`../caddy/Caddyfile`](../caddy/Caddyfile) (snapshot of `/etc/caddy/Caddyfile`
inside the `caddy` container). To update the live Caddy:

```bash
docker cp infra/caddy/Caddyfile caddy:/etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Postgres connectivity

`beakn-postgres` is on `mcp-network` and bound to `127.0.0.1:5432` on the host.
From inside `beakn-app`, **always** use `beakn-postgres:5432` (the container
hostname) — not the host bind. Both flow through the same Postgres daemon, but
the network path inside `mcp-network` doesn't traverse the host's loopback.
