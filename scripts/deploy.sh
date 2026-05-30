#!/usr/bin/env bash
# =============================================================================
# Beakn HVA — production deploy
# =============================================================================
#
# Rebuilds the beakn-app Docker image with the required NEXT_PUBLIC_*
# build-args sourced from .env.local, then restarts the running container
# on mcp-network with --env-file pointing at the same .env.local.
#
# Why this script exists:
#   Next.js inlines `process.env.NEXT_PUBLIC_*` references into the client
#   bundle at BUILD time. Runtime --env-file is too late for client code.
#   The Dockerfile carries an ARG for each NEXT_PUBLIC_* value with a
#   placeholder default so `next build` succeeds in CI/local without
#   secrets. Production rebuilds MUST pass the real values via --build-arg
#   or the placeholder gets baked into the bundle (HVA Turnstile outage
#   2026-05-17 was caused by exactly this — five rebuilds in a row missed
#   the --build-arg).
#
# Run from the repo root on the VPS:
#   bash scripts/deploy.sh
#
# Or with a tag override (e.g. for a hot fix where you want to keep the
# prior image around):
#   IMAGE_TAG=hva119 bash scripts/deploy.sh
#
# Fails loudly if any required NEXT_PUBLIC_* is missing from .env.local or
# still holds the placeholder string from the Dockerfile.
# =============================================================================

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/beakn-home-visit-app}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-beakn-app}"
NETWORK="${NETWORK:-mcp-network}"

cd "$REPO_ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Required build-args. Add new NEXT_PUBLIC_* keys here as they're introduced;
# the script will validate each one against the .env.local row.
# -----------------------------------------------------------------------------
REQUIRED_BUILD_ARGS=(
  NEXT_PUBLIC_TURNSTILE_SITE_KEY
  NEXT_PUBLIC_VAPID_PUBLIC_KEY
)

# Known placeholder values that must NOT be in the live build. Keep in sync
# with the Dockerfile defaults.
PLACEHOLDER_PATTERN='build-time-placeholder'

BUILD_ARG_FLAGS=()
for name in "${REQUIRED_BUILD_ARGS[@]}"; do
  value=$(grep "^${name}=" "$ENV_FILE" | cut -d= -f2- | head -1 || true)
  if [ -z "$value" ]; then
    echo "ERROR: $name missing from $ENV_FILE" >&2
    exit 1
  fi
  if echo "$value" | grep -q "$PLACEHOLDER_PATTERN"; then
    echo "ERROR: $name in $ENV_FILE still holds the Dockerfile placeholder ('$value')" >&2
    echo "       Set the real value in $ENV_FILE before re-running deploy." >&2
    exit 1
  fi
  # Mask the value in stdout so the log doesn't leak the key.
  if [ "${#value}" -gt 8 ]; then
    masked="${value:0:6}…${value: -4}"
  else
    masked="(${#value}-char value)"
  fi
  echo "[deploy] using build-arg $name=$masked"
  BUILD_ARG_FLAGS+=("--build-arg" "$name=$value")
done

# -----------------------------------------------------------------------------
# Computed build-args (HVA-76 — Profile → App Version section).
# These are NOT read from .env.local; they're derived fresh at deploy time
# so every ship records its own commit + timestamp in the client bundle.
# -----------------------------------------------------------------------------
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "[deploy] computed NEXT_PUBLIC_COMMIT_SHA=$COMMIT_SHA"
echo "[deploy] computed NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE"
BUILD_ARG_FLAGS+=("--build-arg" "NEXT_PUBLIC_COMMIT_SHA=$COMMIT_SHA")
BUILD_ARG_FLAGS+=("--build-arg" "NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE")

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------
echo "[deploy] docker build beakn-app:$IMAGE_TAG"
docker build "${BUILD_ARG_FLAGS[@]}" -t "beakn-app:$IMAGE_TAG" -f Dockerfile .

# -----------------------------------------------------------------------------
# Verify build-args actually landed in the client bundle. Catches the
# Dockerfile drifting away from the script's REQUIRED_BUILD_ARGS list.
# -----------------------------------------------------------------------------
for name in "${REQUIRED_BUILD_ARGS[@]}"; do
  value=$(grep "^${name}=" "$ENV_FILE" | cut -d= -f2- | head -1)
  match=$(docker run --rm --entrypoint sh "beakn-app:$IMAGE_TAG" -c "grep -rl '$value' /app/.next/static 2>/dev/null | head -1" || true)
  if [ -z "$match" ]; then
    echo "ERROR: $name was not embedded in the built bundle — check Dockerfile ARG/ENV wiring" >&2
    exit 1
  fi
  echo "[deploy] verified $name baked into $match"
done

# Same verification for the HVA-76 computed args. These are read by the
# profile pages, which are server components — so the inlined value lands
# in /app/.next/standalone (server bundle), NOT /app/.next/static (client
# bundle). Search both locations.
for name_val in "NEXT_PUBLIC_COMMIT_SHA=$COMMIT_SHA" "NEXT_PUBLIC_BUILD_DATE=$BUILD_DATE"; do
  name="${name_val%%=*}"
  value="${name_val#*=}"
  match=$(docker run --rm --entrypoint sh "beakn-app:$IMAGE_TAG" -c "grep -rl '$value' /app/.next 2>/dev/null | head -1" || true)
  if [ -z "$match" ]; then
    echo "ERROR: $name was not embedded in the built bundle — check Dockerfile ARG/ENV wiring" >&2
    exit 1
  fi
  echo "[deploy] verified $name baked into $match"
done

placeholder_match=$(docker run --rm --entrypoint sh "beakn-app:$IMAGE_TAG" -c "grep -rl '$PLACEHOLDER_PATTERN' /app/.next/static 2>/dev/null | head -1" || true)
if [ -n "$placeholder_match" ]; then
  echo "ERROR: '$PLACEHOLDER_PATTERN' still appears in the built bundle ($placeholder_match)" >&2
  echo "       A NEXT_PUBLIC_* var is missing from REQUIRED_BUILD_ARGS or the Dockerfile." >&2
  exit 1
fi
echo "[deploy] confirmed no placeholder strings in /app/.next/static"

# -----------------------------------------------------------------------------
# Migrations (HVA-126)
# -----------------------------------------------------------------------------
# Run BEFORE container restart so the new code boots against a current
# schema. The deploy script runs on the VPS host (not inside a container),
# so the DATABASE_URL hostname is rewritten from the docker-network DNS
# name (`beakn-postgres`) to `127.0.0.1` for direct host access. Same
# pattern as scripts/seed.ts's runtime wrapper.
#
# Failure semantics: scripts/migrate.ts exits non-zero on any migration
# error or on the tamper-hash check. `set -euo pipefail` (line 31) +
# `pipefail` here mean a non-zero exit aborts deploy.sh before the
# container is touched — prod stays on the previous version + schema.
# -----------------------------------------------------------------------------
echo "[deploy] running migrations against live prod DB"
HOST_DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | sed 's|@beakn-postgres:|@127.0.0.1:|' | cut -d= -f2-)
if [ -z "$HOST_DATABASE_URL" ]; then
  echo "ERROR: could not derive host-side DATABASE_URL from $ENV_FILE" >&2
  exit 1
fi
MIGRATE_LOG=$(mktemp)
DATABASE_URL="$HOST_DATABASE_URL" pnpm exec tsx scripts/migrate.ts 2>&1 | tee "$MIGRATE_LOG"
if grep -qE '\[migrate\] done\. applied=0 ' "$MIGRATE_LOG"; then
  echo "[deploy] no migrations pending"
else
  echo "[deploy] migrations applied successfully"
fi
rm -f "$MIGRATE_LOG"

# -----------------------------------------------------------------------------
# Restart
# -----------------------------------------------------------------------------
if [ "$IMAGE_TAG" != "latest" ]; then
  docker tag "beakn-app:$IMAGE_TAG" "beakn-app:latest"
fi

echo "[deploy] stop + remove existing container"
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

echo "[deploy] starting new container on network $NETWORK"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --env-file "$ENV_FILE" \
  -e NODE_ENV=production \
  "beakn-app:latest"

# Healthcheck poll. Container's internal HEALTHCHECK can take ~10s.
echo "[deploy] waiting for healthy status"
for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    echo "[deploy] container healthy after ${i}s"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "ERROR: container did not become healthy in 30s. State: $status" >&2
    docker logs --tail 30 "$CONTAINER_NAME" >&2
    exit 1
  fi
  sleep 1
done

# HVA-169: post-flight env-var warnings. Non-fatal — surface missing
# operator-config so a brand-new VPS doesn't silently ship a half-wired
# feature. Each warning corresponds to a feature that needs out-of-app
# operator action (e.g. installing a host crontab line).
if ! grep -q '^CRON_SECRET=' "$ENV_FILE" || [ -z "$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2-)" ]; then
  echo "[deploy] WARNING: CRON_SECRET is not set in $ENV_FILE." >&2
  echo "[deploy]          /api/cron/roll-over-tasks will refuse ALL requests." >&2
  echo "[deploy]          See docs/cron.md for install steps." >&2
fi

echo "[deploy] done"
