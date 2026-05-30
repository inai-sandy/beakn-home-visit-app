# syntax=docker/dockerfile:1.7

# ---------- Stage 1: deps (pnpm install) ----------
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------- Stage 2: builder (pnpm build) ----------
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next build's page-data collection imports server modules — including
# lib/auth.ts and lib/db. Both throw if their required env vars are unset.
# These dummy values satisfy the throw at build time; the real values come
# from --env-file at runtime.
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV DATABASE_URL=postgres://build:build@localhost:5432/build

# HVA-34: Cloudflare Turnstile site key. NEXT_PUBLIC_* env vars are inlined
# at build time into the client bundle, so this MUST be set during
# `next build` — runtime --env-file is too late for client code. Receive
# the value via a build arg so production builds can pass the real key:
#   docker build --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x… .
# An unset arg falls through to the placeholder so the build still completes
# locally; the live deploy passes the real key in the rebuild command.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=build-time-placeholder-set-at-deploy
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY

# HVA-54: VAPID public key for Web Push subscription. Same NEXT_PUBLIC_*
# rule — inlined at build, validated in scripts/deploy.sh against the
# live .env.local before publish.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=build-time-placeholder-set-at-deploy
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

# HVA-76: commit SHA + build date for the Profile → App Version section.
# deploy.sh computes both fresh at every ship; placeholders here keep
# local `docker build` working but the live deploy always overrides.
ARG NEXT_PUBLIC_COMMIT_SHA=dev
ENV NEXT_PUBLIC_COMMIT_SHA=$NEXT_PUBLIC_COMMIT_SHA
ARG NEXT_PUBLIC_BUILD_DATE=dev
ENV NEXT_PUBLIC_BUILD_DATE=$NEXT_PUBLIC_BUILD_DATE

RUN pnpm build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 --ingroup nodejs nextjs

# Standalone output bundles the server + only the node_modules it traced.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3001

# Polls /api/health (SELECT 1 against beakn-postgres). Container is marked
# unhealthy after 3 consecutive failures; --start-period gives Next.js room
# to boot before failures are counted.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "server.js"]
