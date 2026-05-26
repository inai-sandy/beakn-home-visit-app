# Beakn HVA — Current State

**Last updated:** 2026-05-26 (PR12-FIX — calendar week/month views render an inline event list below the grid so sparse data isn't invisible)

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
- Mobile hamburger drawer mirrors captain pattern; 8 items: Dashboard / Today / Tasks / Contacts / Requests / Resources / Announcements / Profile (HVA-51, HVA-156)
- Resources surface (admin-published sales scripts / pricing / brand assets / training, grouped by category) (HVA-156)
- Announcements surface (admin broadcasts with severity badges + per-user unread badge on drawer) (HVA-156)
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
| 2026-05-26 | PR12-FIX | Sandeep walked /captain/collections/calendar on prod 2026-05-26 — felt "completely broken" because the default month view (anchored at today) showed dots on May 17-19 but clicking any other day landed on an empty day-view. Root cause: sparse payments + a month view with no inline list = invisible data. Fix: `CalendarClient` now renders a `PeriodEventList` below the week and month grids, grouped by day with date headers, so every event in the visible window is readable without drilling in. Day view + per-event chips unchanged. Same component is used by exec calendar, team calendar, and payment calendar — all three benefit. |
| 2026-05-26 | PR12 captain finance | Replaced the /captain/collections "Coming soon" stub with a full finance dashboard. **Money snapshot tiles** (4 across, 2x2 mobile, 1x4 desktop): Order Book (status ≥ ORDER_CONFIRMED), Quotation Pipeline (status = QUOTATION_GIVEN, exclude cancelled), Received (inbound − outbound on Order Book, voided excluded), Outstanding (can go negative → amber "credit owed"). **Aging buckets** (0-7 / 8-30 / 30+ days) with horizontal progress bars showing share. **Filter bar**: debounced search + exec dropdown + city dropdown + section pills (All / Order Book / Pipeline). **Order list**: paginated 10/page, mobile cards + desktop table, sorts outstanding DESC, links to /requests/[id]. New `/captain/collections/calendar` payment-calendar route — every inbound/refund payment as a calendar event (₹amount — customer), reuses CalendarClient with new 'payment' kind tag, same filters. Window-total tiles atop the calendar. All data lives in `lib/captain/finance-queries.ts` (no migration needed — built on existing quotations + payments tables). Team-scope visibility via the existing buildCaptainRequestVisibilityWhere helper. |
| 2026-05-26 | PR11 captain filter+search | Applied the universal filter+search+pagination rule to three captain surfaces. **/captain/calendar** gains `CalendarFiltersBar` — debounced text search (matches customer name + exec name post-query) + exec-dropdown filter (`?exec=`); `loadTeamCalendarEvents` accepts the new options and returns the team roster for the dropdown. **/captain/approvals** gains `ApprovalsFiltersBar` — debounced search (ILIKE on customer name) + exec dropdown; pagination at 10/page via `computePageRange` (in-memory slice after the per-row history sort, acceptable for the bounded pending-approval set). **/captain/requests/unassigned** gains `UnassignedSearchInput` — debounced search (name + digit phone) + server-side LIMIT/OFFSET at 10/page using `buildListUrl` for the prev/next links. All three use the established useTransition-for-URL-push pattern (not a mutation). |
| 2026-05-26 | PR10 scheduled unavailability | New `exec_unavailability_schedules` table (date range + reason + actor) via migration `0044`. `lib/captain/availability.ts` resolves "unavailable today" from BOTH the existing boolean flag AND the schedule. New `addExecUnavailabilityScheduleAction` + `removeExecUnavailabilityScheduleAction` server actions (captain or super_admin, with team-ownership check). New `UnavailabilityScheduleSection` UI on /captain/team/[execId] lists upcoming windows with add/remove. `loadTeammatesForRebalance` + `bulkReassignAffectedVisitsAction` now filter out scheduled-unavailable execs alongside the boolean flag. Two new audit events seeded via the dual-write pattern. |
| 2026-05-26 | PR9 bulk approve | Extracted the per-request approve flow from `/api/requests/[id]/approve/route.ts` into `lib/captain/approve-request.ts`. New `bulkApproveRequestsAction` (50-row cap) iterates the helper and returns `{ approved[], failures[] }` so the UI can render partial results. `/captain/approvals` page becomes a server-render wrapper around a new `ApprovalsListClient` island with row checkboxes + a "Approve N" sticky header that opens a dialog with an optional shared note. Per-row Approve/Reject buttons stay (Reject requires a unique 50-500 char reason per row — not bulk-suitable). Inline minimal Checkbox component (no new shadcn dep). |
| 2026-05-26 | PR8 captain visibility | Three captain-portal improvements. **Stale alerts**: `loadPendingApprovals` + `loadPendingCollections` now return `staleCount` (>24h for approvals, >48h for collections); both dashboard cards render an amber banner linking to the queue when staleCount > 0. **Team search**: `/captain/team` accepts `?q=` and ILIKEs on full_name + phone; new `TeamSearchInput` client component pushes debounced URL. **Team Calendar**: new `lib/captain/calendar-queries.ts:loadTeamCalendarEvents` returns every team exec's visits + tasks (same dedupe rule as exec calendar) with exec-name attached; new `/captain/calendar` route reuses `CalendarClient` via a `basePath` prop addition; exec-name chips render on every event. Nav gets a "Team Calendar" entry between "My Team" and "Contacts". |
| 2026-05-26 | PR7 fetch-based modals | New `lib/api/fetch-action.ts:createFetchAction` adapts a `fetch()` call into the `ActionResult<T>` shape `useServerMutation` expects. Captain's four fetch-based request modals (`assign-request-modal`, `approve-request-modal`, `reject-request-modal`, `reassign-request-modal`) all migrate to the centralised hook through the wrapper — same API routes, same UX, but the busy/refresh/toast quadruplet is gone. fieldErrors + message pass-through preserved. ~10 remaining fetch sites (exec request-detail buttons: payment-record / refund-record / payment-void / quotation-edit / mark-installation-complete / mark-customer-rejected / advance-status / rollback-status) can adopt the same pattern when next touched. |
| 2026-05-26 | PR6 useServerMutation (bulk) | Five more mutation sites move to the centralised hook: PostponeSheet, AddLeadSheet, MoveTaskSheet, ConvertLeadSheet, EditRequestSheet. Each loses its bespoke `useState + useTransition + router.refresh + toast` quadruplet. The hook gains a second `onError` arg carrying `fieldErrors`, so forms with inline per-field error UI (AddLead, ConvertLead, EditRequest) keep that behaviour. `EditRequestResult` narrowed from `ok: boolean` to a discriminated union — strict refinement; existing callers already branched on `result.ok`. ~20 sites remain — fetch-based ones (payment/refund/void/quotation/mark-installation/reject/reassign/assign modals + advance-status-button) need a fetch wrapper; AddTaskSheet has dual actions; EditContactSheet has a collision-id side channel. Those migrate in follow-ups. |
| 2026-05-26 | PR5 followups | Sandeep's "completed count again showing error" — Dashboard `loadExecCompletedTasksToday` no longer filters by `task_date = today`; Option B now applies to completed too (matches Pending behavior). `/tasks` gains a search input that filters Pending + Postponed rows client-side by description, type, or linked customer name (rows are already loaded — no server round-trip). Public `/request` form demotes `email`, `state`, `bhk`, `interest` to optional by widening to `z.union([z.literal(''), ...])` (kept the FieldValues type shape stable so the react-hook-form resolver didn't break this time); API route coerces empty values to `null` / `Others` / `[]` on insert. |
| 2026-05-26 | PR4 useServerMutation (partial) | Migrated 4 hand-rolled mutation sites to the centralised `useServerMutation` hook so the HVA-149 refresh-required pattern lives in one place: `components/reschedule/RescheduleButton`, `RebalanceDialog`, `StartMyDayButton`, `MarkUnavailableToggle`. Each loses its bespoke `useState + useTransition + router.refresh + toast` quadruplet. ~25 more callsites remain — exec today actions, lead/contact sheets, payment/refund/quotation/void buttons, captain assign/approve/reject modals — and migrate incrementally as those surfaces are touched. |
| 2026-05-26 | PR3 team-scope | Captain visibility on `/captain/approvals` and `/captain/requests` switches from `cities.captain_user_id` (city-scope) to `assigned_captain_user_id = me` plus an unaccepted-but-pending-in-my-cities fallback. New `lib/captain/team-scope.ts` centralises the rule. Closes the cross-captain leak where captain B could approve or see captain A's request when both owned overlapping cities. `setExecUnavailableAction` revalidates `/` layout instead of three narrow paths — every surface reading `is_unavailable` now refreshes. |
| 2026-05-26 | PR2 list-UX | Dashboard pending count drops the `taskDate = today OR rolledOverAt IS NOT NULL` predicate — now matches `/tasks` page 1:1 (Option B; future-scheduled tasks like the auto-created Schedule-Visit row surface on both surfaces). Exec `/requests` moves from client-side filter to server-side: bucket → status_code IN(...) WHERE, search → LOWER LIKE on customer_name/customer_phone, pagination 10/page, debounced search updates `?q=`, bucket tabs update `?bucket=`. Bucket counts derived from a single GROUP-BY pass so pills reflect the search-filtered total. |
| 2026-05-26 | PR1 visible bugs | Calendar dedupes visit + auto-task by linkRequestId (was rendering both, looked like duplicate). Schedule-Visit reason + Reschedule input + EditRequestSheet datetime + RebalanceDialog all force `Asia/Kolkata` timezone (Docker server is UTC; was showing 06:30 instead of 12:00 IST and 04:30 in the timeline reason). Universal accordion-closed rule applied to admin-help inbox/thread + exec Dashboard TasksAccordion + exec /tasks TasksPageView. `DEFAULT_PAGE_SIZE` lifted from 20 → 10 with admin-help + other-city imported from the shared constant. Mandatory-field removal on exec-facing forms: AddTask (task type, date, description, estimated time), AddLead (type), ConvertLead (address, bhk), EditRequest (all `required` props dropped from FormRow). Lead.interest demoted to optional. |
| 2026-05-25 | docs sync | docs/CONTEXT.md Resources + Announcements paragraphs rewritten to reflect FIX2 (announcement_acknowledgments rename, audience/publish_date/importance, visibility/tags, pure helpers) |
| 2026-05-25 | HVA-149 (10C-partial) | lib/hooks/use-server-mutation hook bundles useTransition + router.refresh() + toast — prevents the refresh-required bug class. ESLint rule warns on raw useTransition in (exec)/(captain)/admin. One representative call site (AdminHelpSection) migrated as a template; ~60 remaining sites migrate opportunistically (HVA-149-FOLLOWUP). |
| 2026-05-25 | HVA-71 (1C) | Exec Calendar tab — Day / Week / Month views at /calendar. Day = vertical event list; Week = 7-col grid with per-day count; Month = 5-6 week density grid with dot counts. Reads visit_requests + tasks for the exec; navigation persists view/date via query string. Drawer gains a Calendar entry. |
| 2026-05-25 | HVA-72 (2B) | Reschedule flow: exec RescheduleButton on /requests/[id] (required reason, 10-500 chars); customer reschedule on /track/[token] mirroring the cancel pattern (POST /api/track/[token]/reschedule, free-text optional reason). Writes request_reschedule_history + increments visit_requests.reschedule_count + audits + dispatches request.rescheduled (silent until HVA-50). Captain-approval gate deferred. |
| 2026-05-25 | HVA-77 + HVA-94 (3C-lite) | Admin Help round-trip: AdminHelpSection on /requests/[id] for exec to send (10-500 chars); admin inbox at /admin/operations/admin-help with reply-once UI; email notifications on both legs (sendEmail composers inline); admin sidebar shows unread count badge derived directly from admin_help_messages (no engine dep) |
| 2026-05-25 | HVA-85 (6B) | Mark Exec Unavailable + auto-rebalance prompt: toggle flips sales_executives.is_unavailable; when set unavailable AND exec has future-scheduled visits, RebalanceDialog opens listing each visit with per-row reassign-to dropdown (active teammates only). Bulk action transactionally reassigns + writes history rows + audit events + dispatches notifications. |
| 2026-05-25 | HVA-95 (5B) | Other-city Queue at /admin/operations/other-city. Lists out-of-area Submitted requests. Manually Route modal picks a captain + records reason; SUBMITTED → ASSIGNED + history + audit. Sidebar Other-city Queue link updated; All Requests marked placeholder until built. |
| 2026-05-25 | HVA-93 (7A) | Holidays config — admin CRUD at /admin/settings/workflow/holidays (single-date, all-cities). Flipped Workflow & Status subgroup from "Coming soon" to active. Audit events holiday_created / holiday_updated wired (migration 0038) |
| 2026-05-25 | Settings accordion | Admin Settings sidebar group restructured into 6 collapsible accordions per HVA-89 (Organization / Audit & Content / Notifications shipped; Workflow & Status / Targets / AI & Report Cards rendered as "Coming soon" placeholders). Active subgroup auto-expands based on URL. |
| 2026-05-25 | UI unification | Admin Resources/Announcements lists now render the same ResourcesView/AnnouncementsView the team sees, with an overlay ✏️ icon-button per card. Append-only semantics preserved (announcements Manage dialog only toggles published) |
| 2026-05-25 | HVA-61 (10B) | Mark-Done sonner toast gains an Undo action button (5s duration) on top of the existing persistent inline Undo on completed task cards |
| 2026-05-25 | HVA-113 (9A) | Captain deactivation blocked when active sales execs still report; action-layer guard returns 409 with exec count + names; closes HVA-91 spec divergence |
| 2026-05-25 | HVA-39 (7B) | Customer-initiated cancellation: Cancel button + reason picker on /track/[token]; POST /api/track/[token]/cancel; audit + notification fan-out (silent until HVA-50 seeds rules); migration 0037 appends audit event |
| 2026-05-25 | HVA-37 (8B) | BHK-matched proposal + standard catalogues download on customer tracking page, resolved via tagged Resources (1bhk/2bhk/3bhk/4bhk + catalogue tags); strict visibility='all' filter on the public read query |
| 2026-05-25 | HVA-156-FIX2 (2C) | Full HVA-120 + HVA-121 spec closure: Resources gain visibility + tags; Announcements gain admin-managed categories + audience + importance rename + scheduled publish_date + explicit ack tracking with admin ack-rate display; captain ack-drilldown query helper added |
| 2026-05-25 | HVA-89 (1B) | Admin Settings consolidation: all config-y admin surfaces move under /admin/settings/{group}/{page}; sidebar collapses People + Content groups into one Settings group; old URLs 308-redirect (next.config.ts) |
| 2026-05-25 | HVA-156-FIX1 | Resources rework: URL bookmarks + admin-managed categories CRUD + dropdown/search filter + Open/Share buttons (Web Share API + copy-link fallback) |
| 2026-05-23 | HVA-156 | Resources + Announcements: schema (3 tables, 2 enums), super_admin CRUD UI, exec + captain read surfaces, per-user read-tracking, drawer unread badge |
| 2026-05-23 | docs | Claude Code owns full ship pipeline (auto-merge + auto-deploy for low-risk PRs); remove broken SSH/su steps from ship process |
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
| 2026-05-23 | docs | Defer HVA-165 (contact merge) — moved to Frozen pending real-world duplicate patterns from team usage |
| 2026-05-19 | HVA-73 PR2 + PR3 | Notes UI on request detail + both contact detail surfaces (append-only timeline + optimistic write area, commit 6d37f12) |
| 2026-05-19 | HVA-161 | Broaden exec contact visibility to assignment trail (commit 73a7b18 — landed under the HVA-73 PR3 commit message) |
| 2026-05-19 | HVA-73 | Leads section (unified form) |

For tickets older than 2026-05-16, see Linear archive (search project: Phase 1 — MVP Launch).

---

## Queued (not yet started)

- **HVA-149** — Mutation wrapper + ESLint enforcement (architectural)
- **HVA-150** — Optimistic UI + success/error toasts (Phase 2 candidate)
- **HVA-151** — Playwright visual regression (Phase 2 candidate)

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
- **HVA-165** — Contact merge flow. Deferred pending real-world team usage of the contacts system. Sandeep's call 2026-05-23: ship nothing speculative; if the team hits duplicate-contact pain (mistaken double-entries, phone-format drift, business-vs-customer split for the same human) the schema + UI design should be informed by the actual duplicate patterns, not invented up-front. Revisit when concrete duplicate cases surface.

---

## Phase 2 (deferred)

- SSE / real-time updates (HVA-55)
- Optimistic UI (HVA-150)
- Playwright visual regression (HVA-151)
- Push notifications via VAPID (env vars exist in `.env.example`, not wired)
- WhatsApp via Interakt (env vars exist, not wired)
- Multi-language
- AI report cards (Phase 1 spec §11 — no ticket yet)
- Advanced analytics (forecasting, predictive)
- Mark Exec Unavailable toggle (HVA-85) — may lift if operationally needed
- Rolling-deploy / zero-downtime cutover (current rebuild has a few-second gap)
- Containerised drizzle-kit migrator (eliminates host-side override)
