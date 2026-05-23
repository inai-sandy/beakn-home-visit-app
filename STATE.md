# Beakn HVA — Current State

**Last updated:** 2026-05-23 (after CLAUDE.md STATE.md-maintenance-rule ship)

This file captures what's live, what's next, what's blocked, what's deferred. Update after every PR merge.

---

## Phase 1 — Live on prod

### Customer-facing
None yet. Customers raise requests via beakn.in main site, not via HVA. HVA is internal-only.

### Captain portal (13 pages)
- Dashboard with team performance metrics, pending approvals, pending collections (HVA-80, HVA-168)
- Requests tab with search + pagination + filter-by-exec (HVA-127, HVA-153)
- My Team list with exec drill-down — calendar, day plan, report cards, weekly view (HVA-154, HVA-167)
- Contacts page with unified card UI (HVA-73)
- Mobile hamburger drawer (HVA-152)
- Captain approval gate — exec can't bypass to Order Executed (HVA-137)
- Edit access on contacts, requests, team (HVA-163; no delete anywhere)
- Approvals queue, Collections queue, Unassigned requests bucket

### Sales exec portal (11 pages)
- Day plan: Start My Day → visit tasks → close day workflow (HVA-60, HVA-64)
- Dashboard with pending tasks (incl. rolled-over), postponed, completed today (HVA-169)
- Tasks page with Pending / Postponed / Completed accordion (HVA-170)
- Tasks: move semantics for Pending+Postponed, clone for Completed (HVA-170-FIX1)
- Requests tab with 5 buckets, mirrors captain pattern (HVA-65)
- Request detail with customer info + status timeline (HVA-66)
- Contacts/Leads with unified form (Customer/Business toggle) (HVA-73)
- Mobile hamburger drawer mirrors captain pattern; 8 items: Dashboard / Today / Tasks / Contacts / Requests / Resources [stub] / Announcements [stub] / Profile (HVA-51)
- Edit access on contacts, requests, tasks (HVA-159; no delete anywhere)
- Calendar picker for future-dated tasks (HVA-157)
- Auto-task creation on captain assignment (HVA-158)

### Admin portal (5 pages)
- Captains CRUD with reset-password
- Executives CRUD
- Cities CRUD
- Customer support phone config

### Public-facing pages
- Customer visit-request form at /request (HVA-34, HVA-35)
- Customer tracking at /track/[token]
- Login
- Set-password (first-login pin, HVA-26)

### Cross-cutting
- Nightly task roll-over cron at 21:31 IST (HVA-169)
- Audit log on status changes (per `config.audit_enabled_events`)
- Status timeline visible on request detail
- Three-layer auth defence (proxy.ts + layout gates + per-action authorize)
- Better-Auth phone+password sessions with 5-attempt rate limit
- Email via SMTP (nodemailer); WhatsApp channel adapter exists but stub until provider activates

---

## Recently shipped (most recent first)

| Date | Ticket | Summary |
|---|---|---|
| 2026-05-23 | docs | Add STATE.md maintenance rule to CLAUDE.md — every feature PR must update STATE.md in the same PR |
| 2026-05-23 | HVA-170-FIX3 | UI polish: customer name on task rows + EXEC_DRAWER_NAV in desktop sidebar + LinkedCustomerChip (PR #109) |
| 2026-05-22 | HVA-170-FIX2 | Customer link display fix on edit/clone (linkSearch state init was empty) + SQL same-day filter fix |
| 2026-05-22 | HVA-170-FIX1 | Move semantics for Pending/Postponed, drop link auto-copy on Clone, double-submit guard |
| 2026-05-22 | HVA-51 + HVA-170 | Sales exec hamburger drawer + Tasks page + Start-My-Day enhancement + clone flow |
| 2026-05-22 | HVA-171 | Fix HVA-169 dashboard postponed predicate + calendar wiring |
| 2026-05-21 | HVA-169 (HVA-155 Parts A+B) | Sales exec analytical dashboard + nightly task roll-over cron |
| 2026-05-21 | HVA-168 | Fix Pending Approvals stale predicate + Orders click-credit attribution |
| 2026-05-21 | HVA-167 | Captain exec drill-down page `/captain/team/[execId]` |
| 2026-05-21 | HVA-154 | Captain My Team list + exec drill-down (calendar, day plan, weekly view) |
| 2026-05-20 | HVA-166 | Unify Contacts card UI (captain + exec) |
| 2026-05-19 | HVA-163 | Captain portal edit access (no delete) |
| 2026-05-19 | HVA-73 PR1 + HVA-157 + HVA-158 + HVA-159 | Contacts CRM shift + calendar picker + auto-contact + edit access |
| 2026-05-18 | HVA-153 | Captain Requests tab search + pagination + filter |
| 2026-05-18 | HVA-80 | Captain Dashboard two-column layout |
| 2026-05-17 | HVA-137 | Captain approval gate (closes exec bypass to Order Executed) |
| 2026-05-16 | HVA-66 | Request detail screen with customer info + status timeline |
| 2026-05-18 | HVA-65 | Exec Requests tab (5 buckets) |
| 2026-05-19 | HVA-73 | Leads section (unified form) |

For tickets older than 2026-05-16, see Linear archive (search project: Phase 1 — MVP Launch).

---

## Queued (not yet started)

- **HVA-73 PR2** — Notes UI on request detail + banner refactor
- **HVA-73 PR3** — Notes UI on contact detail
- **HVA-149** — Mutation wrapper + ESLint enforcement (architectural)
- **HVA-150** — Optimistic UI + success/error toasts (Phase 2 candidate)
- **HVA-151** — Playwright visual regression (Phase 2 candidate)
- **HVA-156** — Resources + Announcements content (scope undefined; stub pages already shipped in HVA-51 bundle)
- **HVA-161** — Broaden exec contact visibility to assignment trail (reassignment keeps prior exec visible)
- **HVA-165** — Contact merge flow (deferred from HVA-159)

---

## Cleanup tickets to file (from recon)

- Delete `.env.local.bak` at repo root (stale backup)
- Delete `scripts/align-migrations-table-hva111.sql` if HVA-111 is fully past
- Rename `app/dev/logout-test/actions.ts` → `lib/auth/logout-action.ts` (production-load-bearing despite the dev path)
- Verify or remove stale captain mobile-shell snapshot test comment in `app/(captain)/layout.tsx`
- Verify Caddyfile bind-mount status (MEMORY → caddy-infra flagged this as pending)

---

## Blocked

All WhatsApp-dependent tickets are blocked pending activation of Meta WhatsApp Business or Interakt provider:

- **HVA-45** — `lib/whatsapp.ts` provider abstraction (urgent priority)
- **HVA-46, HVA-47, HVA-49, HVA-50, HVA-79** — various WhatsApp notification flows
- **HVA-155 Part C** — 9:30 PM WhatsApp day-close reminder

Until WhatsApp provider activates, stub mode is the default. Code paths exist at `lib/notifications/channels/whatsapp.ts`; no real messages send.

---

## Frozen / pending real-world data

- **HVA-170 extensions** — Additional task management ideas (Move/Duplicate buttons beyond what shipped, dedicated /tasks-vs-dashboard architecture) frozen pending 2–3 days of real-world usage data on /tasks page (shipped 2026-05-22). Most ideas in the original placeholder may turn out to be unnecessary or contradict auto-roll-over behavior.

---

## Phase 2 (deferred)

- SSE / real-time updates (HVA-55)
- Optimistic UI (HVA-150)
- Playwright visual regression (HVA-151)
- Push notifications via VAPID (env vars exist in `.env.example`, not wired)
- WhatsApp via Interakt (env vars exist, not wired)
- Multi-language
- AI report cards (Phase 1 spec §11 — no ticket yet)
- Resources content (Phase 1 spec §12 — HVA-156 stub only)
- Announcements content (Phase 1 spec §13 — HVA-156 stub only)
- Advanced analytics (forecasting, predictive)
- Mark Exec Unavailable toggle (HVA-85) — may lift if operationally needed
- Rolling-deploy / zero-downtime cutover (current rebuild has a few-second gap)
- Containerised drizzle-kit migrator (eliminates host-side override)
