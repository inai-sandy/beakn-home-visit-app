# Beakn Home Visit App — Engineering Context for Claude Code

This file is auto-loaded at the start of every Claude Code session in this repo.

**Always read these two companion files at session start:**
- `STATE.md` — what's shipped, what's queued, what's blocked, what's deferred
- `docs/CONTEXT.md` — product context, user types, business logic

**Additional session memory** (auto-loaded by Claude Code outside this repo):
- `/home/beakn/.claude/projects/-opt-beakn-home-visit-app/memory/MEMORY.md` — session lessons, infra-edit protocols, HVA-14 deferrals, schema workflow rules. Reference by linked filename (e.g. `caddy-infra.md`, `hva-16-runtime.md`).

---

## Project

**What it is:** Beakn Home Visit App (HVA). Internal field-ops app for Beakn's sales executives and captains. Customers raise visit requests via beakn.in; sales execs visit homes; captains manage teams across 8 cities.

**Live at:** https://visits.beakn.in
**Repo:** github.com/inai-sandy/beakn-home-visit-app
**Working dir on VPS:** /opt/beakn-home-visit-app
**Phase 1 scope:** Customer request → captain assigns → exec visits → quotation → order. End-to-end pipeline live.
**Phase 1 completion:** ~60% as of 2026-05-22.

---

## Stack (verified by recon 2026-05-22)

- **Framework:** Next.js **16.2.6** App Router (Server Components by default)
- **React:** 19.2.4
- **Database:** Postgres 16 (via Drizzle ORM 0.45.2)
- **Auth:** Better-Auth 1.6.11 (DB-backed sessions, NOT JWT)
- **Styling:** Tailwind **v4** + shadcn/ui primitives
- **Icons:** Material Symbols (via `<Icon>` wrapper) + lucide-react
- **State:** Server Components + `useTransition` for mutations
- **Forms:** react-hook-form + Zod 4 validators (ADR-001)
- **Logging:** pino with `log.child({ component })` pattern
- **Email:** nodemailer via SMTP
- **Testing:** Vitest 4 + Testcontainers Postgres (real DB, no mocks)
- **Package manager:** **pnpm 11.1.1** (pinned via `packageManager` field)
- **Node:** **22** (Alpine in Docker — NOT 20; pnpm 11.x needs `node:sqlite`)
- **Routing:** `proxy.ts` at repo root (Next 16 replaces `middleware.ts`)
- **Deploy:** Docker on Hostinger VPS, single container, `scripts/deploy.sh`

---

## Repo layout

```
app/
  (captain)/        — captain portal (13 pages)
  (exec)/           — sales exec portal (11 pages)
  admin/            — super_admin surfaces (5 pages)
  api/              — 30 endpoints (admin, auth, cron, customer-request, health, requests)
  dev/              — 11 dev-only health pages (production-blocked at proxy.ts)
components/         — ~40 components (ui/, lists/, dashboard/, contacts/, leads/, notes/, requests/, today/)
db/
  schema/           — 17 files, 22 tables, 11 enums
  migrations/       — 31 sequential .sql files
docs/               — config.md, cron.md, decisions.md, first-login.md, migrations.md, secrets.md
infra/
  caddy/Caddyfile   — snapshot (live config inside caddy container; see MEMORY → caddy-infra)
  docker/           — README + backup/
lib/                — domain logic (auth, admin, captain, cron, exec, today, notes, notifications, hooks, validators)
public/             — static assets, PWA manifest, sw.js
scripts/            — deploy.sh, migrate.ts, seed.ts + variants
tests/              — 78 files, 719 tests
proxy.ts            — top-level route gating (replaces middleware.ts)
```

**Path alias:** `@/*` → `./*` (repo root)

---

## Infra

- **Production VPS:** Hostinger Mumbai, IP `31.97.226.201`, hostname `srv929020.hstgr.cloud`
- **OS:** Ubuntu 24.04 LTS
- **SSH:** `ssh root@31.97.226.201`
- **App path:** `/opt/beakn-home-visit-app`
- **App user:** `beakn` (switch with `su -l beakn`; no sudo)
- **Docker network:** `mcp-network` (172.18.0.0/16, gateway 172.18.0.1) — shared with MCP stack
- **HVA app container:** `beakn-app` on mcp-network, port **3001** (NOT 3000 — that's `dataforseo-mcp`)
- **HVA Postgres:** `beakn-postgres` container, bound to `127.0.0.1:5432` only (NOT host-exposed)
- **Caddy:** shared `caddy` container, reverse-proxies `visits.beakn.in → beakn-app:3001`
- **Public domain:** visits.beakn.in (Cloudflare DNS, NOT Hostinger DNS)
- **Health check:** `curl -sf http://localhost:3001/api/health` returns `{"status":"ok","db":"connected","timestamp":"..."}`

**Other containers on the same VPS (DO NOT TOUCH):**
- `rag-postgres` — RAG-system's Postgres, internal only
- `rag-mcp`, `dataforseo-mcp`, `mcp-mem0` — MCP stack
- `portainer` — Docker UI

**DATABASE_URL dual-form rule** (critical, see MEMORY → hva-16-runtime):
- **Inside container:** `postgresql://...@beakn-postgres:5432/beakn_app`
- **From host:** `postgresql://...@127.0.0.1:5432/beakn_app`
- `.env.local` uses container form. Host-side migrations need one-line override:
  ```
  DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app pnpm db:migrate
  ```

---

## Architectural locked decisions (verified in code, immutable)

These are non-negotiable. Section 17 of the recon confirmed all 7 enforced in code.

### Data model
- **No deletes anywhere.** No `.delete()` Drizzle calls in production code. Only operational cleanup (rate_limit_attempts window prune). No soft-delete columns either.
- **Notes are append-only.** `lib/notes/actions.ts` only exports `addNoteAction`. No edit, no delete. Notes schema has no `updated_at`.
- **Phone is dedup key for contacts.** Indian-normalized: `+91` + 10 digits stored verbatim. Dedup is app-enforced via `lib/captain/contact-linker.ts`.
- **IST timezone everywhere.** `lib/date.ts` exports `TIMEZONE = 'Asia/Kolkata'`. Never hardcode 'UTC' in user-facing date logic.
- **Money as paise integers.** All monetary columns are `bigint('xxx_paise', { mode: 'number' })`. ₹100 = 10000. Never float, never `numeric`. Conversion at display boundary only.
- **UUIDv7 for all primary keys.** Sortable. Use `uuid('id').primaryKey().default(sql\`uuid_generate_v7()\`)`. Function defined in initial migration.
- **All timestamps with timezone.** `created_at` + `updated_at` via shared `timestamps()` helper in `db/schema/_helpers.ts`. `$onUpdate(() => new Date())` for updated_at.

### Visibility
- **Captain visibility is team-scoped,** not city-scoped. Joins on `sales_executives.captain_user_id`. NOT cities.
- **Exec contact visibility:** captured-by + assignment-trail (HVA-73 PR3 broadened). Reassigned-away contacts still visible.

### Architecture
- **Responsive via Tailwind hide/show classes** (`hidden lg:contents` + `lg:hidden`). Never replace a shell with a "responsive component."
- **Two-sidebar pattern for portals:** desktop sidebar (`hidden lg:contents` wrapper) + mobile drawer (Sheet with `lg:hidden` trigger). Reference: `app/(captain)/_components/CaptainSidebarSheet.tsx`.
- **No SSE / real-time / WebSocket.** Grep confirms zero usage. Phase 2 territory.
- **No optimistic UI.** No `useOptimistic` usage. Server-action → revalidate → re-render is the pattern.
- **`db/client.ts` is lazy.** Module exports a Proxy that initialises Drizzle on first method call. Don't "simplify" to top-level init — `next build` page-data collection breaks.

### Server action contract
- **Universal return shape:** `ActionResult<T> = { ok: true; data?: T } | { ok: false; error: string }`. Sometimes `fieldErrors` for form actions. Never throws.
- **`authorize()` at top.** Every action gates via `getServerSession()` + role check before mutating.
- **`revalidatePath('/', 'layout')`** on every successful mutation. Whole layout tree, not segment.
- **Closed-day guard:** every today-loop action refuses if `day_plan.closedAt !== null`.
- **Audit emission:** opt-in per action, gated by `config.audit_enabled_events` (dual-write pattern — migration appends to config row AND `lib/config-schema.ts` defaults). `lib/audit.ts:logEvent` never throws.

### Auth (3-layer defence)
1. **HTTP layer:** `proxy.ts` redirects + role gates + must-change-password pin
2. **Route-group layer:** `decideExecAccess` / `decideAdminAccess` in layouts
3. **Action layer:** `authorize()` inside every server action

### Audit history tables (not generic soft-delete)
- `audit_log` (generic, polymorphic via `target_entity_type` + `target_entity_id`)
- `request_status_history` (status transitions; UNIQUE on `(request_id, transition_order)` per HVA-141)
- `request_reschedule_history` (visit reschedules)
- `request_exec_assignments` (captain-driven reassignment trail; indexed for visibility lookups)

---

## Workflow (every code change)

### Step 0 recon (mandatory before any code)
Every implementation prompt starts with a "read files, report findings, STOP" gate. Quote schema verbatim. Identify gaps. Surface mismatches between spec wording and actual code. Wait for confirmation before writing code.

**Schema-issue workflow** (when a ticket touches 3+ entities/tables): follow `MEMORY → hva-schema-workflow`. Source map → AC update → flag-rename comments → code. Never inverted.

### Pre-PR gate (all three must pass — non-negotiable)
```
pnpm tsc --noEmit
pnpm next build
pnpm test
```
**Not just `tsc`** — `next build` catches narrowing-induced `never` errors. Past bugs were missed because only tsc ran.

### Ship process (Claude Code owns end-to-end)
```
# After Sandeep approves the implementation:
git push origin <branch>
gh pr create --title "HVA-XXX: <description>" --body "..."
gh pr merge <PR> --squash --delete-branch

ssh root@31.97.226.201
su -l beakn
cd /opt/beakn-home-visit-app
git pull --ff-only origin main
bash scripts/deploy.sh
curl -sf http://localhost:3001/api/health
```

**Expected deploy output:**
- Build-arg validation: NEXT_PUBLIC_TURNSTILE_SITE_KEY present + non-placeholder
- Bundle grep: `.next/static/**` contains the real Turnstile key
- Migrations: `applied=N skipped=M`
- Container healthy within 30s polling window
- `/api/health` returns 200 `{"status":"ok","db":"connected"}`

**Branch naming:** `sandypublic/hva-XXX-<kebab-slug>` (Linear's `gitBranchName` field auto-suggests).

**Commit co-author tag:** include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` in every commit.

### Walk discipline (Sandeep's job, not Claude Code's)
- Walk every shipped feature on a **real phone** (not DevTools emulator).
- Numbered step checklist per ship.
- Desktop regression check FIRST when any shell/layout change ships.
- Walk after every ship. Don't bundle walks across multiple ships.

---

## STATE.md maintenance (every ship)

Every feature PR must include a STATE.md update in the same PR. No separate micro-PRs unless forgotten.

**Required edits when shipping a ticket:**

1. Bump "Last updated" line at top of STATE.md to today's date + ticket reference.
2. Add new row at TOP of "Recently shipped" table:
   `| YYYY-MM-DD | HVA-XXX | <one-line summary> (PR #NNN) |`
3. Remove the ticket from "Queued (not yet started)" section if it was listed there.
4. If the ticket changes blocked/frozen/Phase 2 status of any other ticket, update those sections too.

**Why:** STATE.md drift is real and starts immediately. The four-question verification test on 2026-05-23 caught a 1-day-old gap when HVA-170-FIX3 shipped without a STATE.md bump. Bundling the STATE.md edit into the feature PR makes drift impossible — STATE.md ships atomically with the ship it describes.

**Anti-pattern:** Don't open a "STATE.md bump" micro-PR after merging the feature PR. Two PRs for one ship is wasted overhead. Only acceptable as fallback when the feature PR forgot the bump.

---

## DO NOT (universal anti-patterns)

- DO NOT add new dependencies for one-off needs. Use existing shadcn primitives + lucide + Tailwind + radix-ui umbrella. New deps need explicit justification.
- DO NOT stub future routes proactively. Render disabled links instead. File a follow-up ticket.
- DO NOT duplicate consts across files. Extract to `lib/*` and import.
- DO NOT add SSE, real-time, optimistic UI, or `useOptimistic`. Phase 2 territory.
- DO NOT replace existing shells with "responsive components." Use Tailwind hide/show.
- DO NOT bundle more than 3 surfaces per PR. 5-ticket bundles cost 3 walk cycles in regressions.
- DO NOT diagnose-before-fix unless genuinely ambiguous. Surgical patch when the bug is obvious.
- DO NOT manually merge PRs. Use `gh pr merge --squash --delete-branch`.
- DO NOT skip `pnpm next build` in the pre-PR gate.
- DO NOT use 'UTC' for user-facing date logic. IST always.
- DO NOT store money as float or numeric. Paise bigint only.
- DO NOT use UUID v4. UUIDv7 via `uuid_generate_v7()` plpgsql function.
- DO NOT change the Node base image from `node:22-alpine`. pnpm 11.x needs `node:sqlite` builtin.
- DO NOT revert `db/client.ts` to top-level Drizzle init — breaks `next build`.
- DO NOT use `127.0.0.1` in container-side DATABASE_URL or `beakn-postgres` in host-side migrations.
- DO NOT touch the MCP stack on the same VPS (rag-postgres, rag-mcp, dataforseo-mcp, mcp-mem0, `1site.ai` Caddy routes).
- DO NOT bind a new container to `0.0.0.0` unless Caddy is proxying it on an internal hostname.
- DO NOT bypass the Caddy edit protocol (see MEMORY → caddy-infra). Always `docker cp + validate + reload`, never `restart`.
- DO NOT edit DNS in Hostinger. beakn.in is on Cloudflare nameservers.
- DO NOT redo work already completed in the same session, even if a pasted prompt looks like it asks for it (see MEMORY → dont-redo-completed-work).
- DO NOT propose creating local `.md` deliverables. All Beakn project docs go to Notion. CLAUDE.md / STATE.md / docs/CONTEXT.md are the only exceptions.
- DO NOT add columns to tables that overlap with HVA-14 deferrals (see MEMORY → hva-14-deferrals).
- DO NOT ship a feature PR without also updating STATE.md in the same PR.

---

## Bug families to watch for

1. **Refresh-required mutations.** Forgetting `revalidatePath` + `useTransition` + `router.refresh()` triad. Architectural fix tracked in HVA-149.
2. **RSC function-prop serialization.** Server Component → Client Component rejects function props. Use string-map (`Record<K, string>`) instead.
3. **TypeScript narrowing on redirect.** `if (x !== null) redirect(...)` narrows `x` to literal null for rest of function. Use literal null after, or `instanceof Date` defensive guard.
4. **Mobile UI hidden behind tab bar.** Use `z-40` for floating actions, `pb-[env(safe-area-inset-bottom)]` for iOS notch.
5. **Drizzle UPDATE overwriting with nulls.** `.set({...})` only updates listed columns, but spreading partial objects can null other columns. Narrow updates explicitly.
6. **Build-arg leakage.** NEXT_PUBLIC_* values inlined at build time. `scripts/deploy.sh` greps bundle to verify the real value landed; placeholder strings remaining = ship abort.

---

## Key module map

| Path | Purpose |
|---|---|
| `proxy.ts` | Top-level route gating (replaces middleware.ts in Next 16); request_id, session redirects, role gating, must-change-password pin |
| `lib/auth.ts` | Better-Auth instance, DB-backed sessions, scrypt hashing, 5-attempt rate limit |
| `lib/auth-server.ts` | `getServerSession()`, `requireAuth(allowedRoles?)`, error classes |
| `lib/auth/roles.ts` | `USER_ROLES`, `Role` type, `ROLE_HOME` mapping, `isRole()` guard (HVA-107) |
| `lib/exec-authz.ts` / `lib/admin-authz.ts` | `decideExecAccess` / `decideAdminAccess` layout gates |
| `lib/admin/auth-helper.ts` | `requireSuperAdmin()` for `/api/admin/*` handlers |
| `lib/date.ts` | IST helpers — `TIMEZONE`, `toIst`, `fromIstInput`, `addDaysIst`, `parseDate` |
| `lib/today/time.ts` | `getIstDateString`, `ESTIMATED_TIME_BUCKETS`, `formatMinutesAsBucket` |
| `lib/phone.ts` | `normalizeIndianPhone`, `toStorageFormat` (input side) |
| `lib/format/phone.ts` | `formatForDisplay` (output side) — kept separate from `lib/phone.ts` |
| `lib/money.ts` | Paise integer helpers |
| `lib/pagination.ts` | `parsePage`, `computePageRange`, `buildListUrl` (HVA-153) |
| `lib/status-transition.ts` | Central `transitionRequestStatus({...})` mutator with validation + audit + notifications |
| `lib/config.ts` + `lib/config-schema.ts` | Runtime-tunable knobs; catalogue with type/category/defaults per key |
| `lib/audit.ts` | `logEvent({...})` — never throws, gated by `audit_enabled_events` config |
| `lib/exec/dashboard-queries.ts` | Today-bounded helpers for /dashboard |
| `lib/exec/tasks-page-queries.ts` | Cross-date helpers for /tasks (HVA-170) |
| `lib/exec/visible-contacts.ts` | Captured-by + assignment-trail visibility (HVA-73 PR3) |
| `lib/exec/edit-auth.ts` | `canExecEditContact/Request/Task` |
| `lib/exec-nav.ts` | `EXEC_NAV` (bottom-nav, 5 items) + `EXEC_DRAWER_NAV` (drawer + desktop, 8 items) |
| `lib/captain/nav.ts` | `CAPTAIN_NAV_ITEMS` + active-state + page-title resolver |
| `lib/captain/dashboard-queries.ts` | Team performance, pending approvals, pending collections |
| `lib/captain/exec-drill-queries.ts` | `canCaptainViewExec`, drill-down loaders |
| `lib/captain/contact-linker.ts` | `findOrCreateContactForAssignment` (phone-dedup) |
| `lib/captain/edit-auth.ts` | `canCaptainEditTask/Request/Contact` |
| `lib/cron/roll-over-tasks.ts` | `rollOverPendingTasks(now?)` (HVA-169, 21:31 IST cron) |
| `lib/notes/actions.ts` | `addNoteAction` (append-only) |
| `lib/notes/queries.ts` | `loadNotesForEntity`, `canWriteNoteForEntity` |
| `lib/notifications/engine.ts` | `dispatchEvent({...})` — fans out to channel adapters per rules |
| `lib/notifications/channels/whatsapp.ts` | WhatsApp channel adapter (stub until provider activates) |
| `lib/validators/` | 15 per-form Zod schemas |
| `app/(captain)/_components/CaptainSidebarSheet.tsx` | Captain mobile drawer — reference pattern |
| `app/(exec)/_components/ExecSidebarSheet.tsx` | Exec mobile drawer (mirrors captain) |
| `app/(exec)/today/actions.ts` | 9 server actions: startDay, addTask, editTask, markTaskDone, undoMarkDone, undoPostpone, postponeTask, closeDay, moveTask |
| `app/dev/logout-test/actions.ts` | `logoutAction` — production-load-bearing despite dev path name |
| `app/api/cron/roll-over-tasks/route.ts` | HVA-169 cron endpoint, CRON_SECRET bearer auth |
| `db/schema/_helpers.ts` | `timestamps()` factory for created_at/updated_at |
| `db/schema/index.ts` | Barrel re-export of all 17 schema files |
| `scripts/deploy.sh` | Production deploy: build-arg validation, bundle-grep verification, migration, container restart, healthcheck poll |
| `scripts/migrate.ts` | SHA256-tracked migration runner (replaces drizzle-kit migrate, HVA-111) |

---

## pnpm scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Next dev on port 3001 |
| `pnpm build` | Production build (standalone output) |
| `pnpm start` | Start prod server on 3001 |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest run (sequential, real Postgres testcontainer) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Coverage report (per-file include list in vitest.config.ts) |
| `pnpm db:migrate` | Run pending migrations via scripts/migrate.ts |
| `pnpm db:studio` | drizzle-kit studio |
| `pnpm db:psql` | psql shell into beakn-postgres |
| `pnpm db:seed` | Full bootstrap seed (cities, status_stages, super_admin) |
| `pnpm db:seed:config` | Seed config table from defaults |
| `pnpm db:seed:test-admin` | Create test super_admin with known temp password |
| `pnpm m3:generate` | Regenerate Material Design 3 colour tokens from Deep Teal #0F766E |
| `pnpm icons:generate` | Regenerate PWA icon set |

---

## Prompt-writing rules (Sandeep → Claude Code)

When Sandeep writes a Claude Code prompt:

- **Plain English instructions, not code.** Specify file paths, behavior, validation rules. Claude Code reads files and writes implementation.
- **Locked decisions section** labeled D1, D2, D3 with reasoning.
- **DO NOT list** at the bottom with specific anti-patterns.
- **Tests listed as cases**, not test code.
- **Ship steps explicit** — PR command, merge command, deploy command, health check command.
- **Estimated time included.**

Claude Code's job is to do Step 0 recon, ask clarifying questions if ambiguous, then implement — NOT to interpret freeform requirements.

---

## When in doubt

1. Read `STATE.md` for current state of shipped/queued/blocked work.
2. Read `docs/CONTEXT.md` for product context (user roles, business logic, core concepts).
3. Read `MEMORY.md` linked files for infra-edit protocols + session lessons.
4. If still unclear: ask Sandeep one question. Don't proceed on assumption.
5. Surface assumptions explicitly before executing.
6. Make a decision with reasoning when delegated. Don't bounce back.

---

## References

- **Linear:** team `Home Visit App`, project `Phase 1 — MVP Launch`, branch naming `sandypublic/hva-XXX-<slug>`
- **GitHub:** `inai-sandy/beakn-home-visit-app`
- **Notion source-of-truth docs:** see `docs/CONTEXT.md` for IDs
- **Cloud infra detail:** MEMORY → `vps-infra`, `caddy-infra`, `hva-16-runtime`
- **Schema design rules:** MEMORY → `schema-conventions`, `hva-schema-workflow`
- **HVA-14 deferrals (auth/notification overlaps):** MEMORY → `hva-14-deferrals`
