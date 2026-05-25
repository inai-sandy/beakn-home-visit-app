# Beakn HVA — Product Context

**Last updated:** 2026-05-25

This file gives Claude Code the *what* and *why* of HVA. Update monthly.

---

## Beakn (parent business)

Beakn is an Indian D2C smart home automation brand (beakn.in). Sells 170+ SKUs across switches, plugs, IR blasters, sensors, motorized curtains, BLDC fans, smart locks, lighting. Manufactures via a partner (never named publicly). Operates across 8 cities: Hyderabad, Bangalore, Chennai, Ahmedabad, Vizag, Vijayawada, Mumbai, Pune.

Field operations require a sales team to visit customer homes for site assessment, product demos, and installation supervision. HVA exists to manage that field operation.

---

## User roles

### Customer
- Visits beakn.in (main marketing site, separate from HVA).
- Raises a visit request via a form at `/request`.
- Does NOT have an HVA login.
- Receives WhatsApp updates (Phase 2) and can track via `/track/[token]`.

### Sales Executive (exec, sometimes called "ranger")
- Field worker. Visits customer homes.
- HVA login. Works primarily on mobile.
- Daily flow:
  1. Morning: opens `/today`, taps "Start My Day" to create today's day plan.
  2. Day: works through assigned visit requests + ad-hoc tasks. Marks each done with outcome (Quotation sent / Order placed / Postponed / Other).
  3. Evening: closes the day at `/today/close` with amount collected + quotations submitted count.
- Reports to one captain.
- Assigned to one or more cities.

### Captain
- Team lead. Manages 3–10 execs in their cities.
- HVA login. Uses desktop (laptop) primarily, mobile occasionally.
- Approves exec actions before they finalize (e.g., Order Executed needs captain approval per HVA-137).
- Reviews team performance, pending collections, pending approvals at `/captain/dashboard`.
- Drill-downs into individual exec performance at `/captain/team/[execId]`.
- Reports to super_admin.

### Super Admin (Sandeep)
- Owner. Sees everything.
- Manages users, cities, captain→exec assignments at `/admin/*`.
- Escape hatch on most authorization checks.

---

## Core concepts

### Visit Request (`visit_requests`)
- A customer's request for a home visit.
- Status pipeline (managed via `lib/status-transition.ts`):
  NEW → ASSIGNED → SCHEDULED → VISITED → QUOTATION_SENT → PENDING_CAPTAIN_APPROVAL → ORDER_PLACED → ORDER_EXECUTED → CLOSED
- Branches for postpone, customer rejection, cancellation.
- Assigned by captain to one exec at a time (reassignment is allowed; HVA-161 will broaden visibility to assignment trail).
- Linked to one contact (customer record via `contact_id`, runtime FK in migration 0023).
- Has `tracking_token` (unique) so customers can track without login.

### Day Plan (`day_plans`)
- One per exec per day. Created when exec taps "Start My Day."
- Records: `scheduled_visit_count`, `additional_task_count`, `is_late`, `submitted_at`.
- Closes when exec submits end-of-day metrics: `amount_collected_paise`, `quotations_submitted_today`, `closed_at`.
- UNIQUE on `(exec_user_id, plan_date)`.
- Used by captain to see what each exec planned and accomplished.

### Task (`tasks`)
- Atomic unit of work for an exec.
- Two sources:
  - Auto-created from a visit request (`link_request_id`) when captain assigns
  - Manually added by exec for a lead/contact (`link_lead_id`)
- Has `status`: pending / completed / postponed / cancelled.
- Has `task_date` (the day it's scheduled for) and optionally `postponed_to_date`.
- Outcome captured on completion: `outcome_option_id` + `outcome_notes` + `actual_time`.
- Notes do NOT exist on tasks — `note_target_type` enum has only 'request' and 'contact'.
- `outcome_notes` is a free-text column on the task row itself (different from polymorphic notes).
- `rolled_over_at` stamped by HVA-169 nightly cron when overdue.

### Contact (`leads` — unified customers + business leads)
- A person or business the exec has met or worked with.
- Phone is dedup key (Indian-normalized: `+91` + 10 digits).
- Can have many requests over time (HVA-73 PR1 shifted the data model to support this conceptually).
- Visibility: exec sees contacts they captured + contacts whose requests are assigned to them (HVA-73 PR3 broadens via reassignment trail).
- Type enum: Customer | Business.
- Business contacts have `firm_name` + `business_type_id`.

### Notes (`notes`, polymorphic on 'request' or 'contact')
- Append-only. No edit, no delete.
- Attached to a request or a contact.
- NOT attached to tasks (schema constraint per `note_target_type` enum).
- No DB FK on `target_id` (polymorphic, validated app-side via `lib/notes/queries.ts:canWriteNoteForEntity`).

### Resources (`resources` + `resource_categories`, HVA-156 + HVA-156-FIX1)
- Admin-published URL bookmarks visible to every captain + every sales exec (broadcast, no per-row scoping).
- Each resource = title + URL (required) + optional 500-char description + category FK.
- Categories live in an admin-managed `resource_categories` table (name + slug + sort_order + is_active). No deletes — deactivate to hide from filter + new uploads while preserving FK references.
- super_admin authors. Captain + exec both read at `/resources` and `/captain/resources` (same component, same query).
- Read surface filters by category dropdown + free-text search. Per row: Open (target=_blank) + Share (Web Share API → WhatsApp/Gmail/anywhere; copy-link fallback on desktop).
- Phase 2 (HVA-121 full spec, planned in HVA-156-FIX2): visibility enum (all / captains-only / execs-only), free-form tags[] for filtering, drag-reorder on categories.

### Announcements (`announcements` + `announcement_reads`, HVA-156)
- Admin broadcasts to staff (sales exec + captain). super_admin authors. Append-only — no edit. Unpublish toggles `is_published`.
- Severity enum (info / important / urgent). Mapped to display badge.
- Per-user read-tracking via `announcement_reads` composite-PK join table. Powers the unread-count badge on the exec + captain drawers.
- Surface: `/announcements` + `/captain/announcements`. Mount-effect fires `markAllAnnouncementsReadAction` (idempotent via ON CONFLICT DO NOTHING).
- Phase 2 (HVA-120 full spec, planned in HVA-156-FIX2): admin-managed announcement categories, audience enum (sales_executive / captain / both), importance enum rename, scheduled `publish_date` with 06:00 IST cron fan-out, one-way "I've read this" acknowledgment with per-announcement ack rate visible to admin + captain.

### Auto-roll-over (HVA-169)
- Nightly cron at 21:31 IST (`/api/cron/roll-over-tasks` with CRON_SECRET bearer auth).
- Overdue pending tasks (`task_date < today`, `status='pending'`) get `rolled_over_at` stamped.
- Surface on today's plan with a "Rolled over from [date]" pill.
- Postponed tasks roll based on `postponed_to_date`.

### Quotations & Payments (`quotations`, `payments`)
- One quotation per visit_request (UNIQUE constraint).
- `total_order_value_paise` in paise.
- Payments are domain events (inbound = customer pays, outbound = refund). `voided_at` for reversals.

### Audit history (NOT generic soft-delete)
- `audit_log` — generic polymorphic event log, gated by `config.audit_enabled_events`.
- `request_status_history` — every status transition with UNIQUE `(request_id, transition_order)` per HVA-141.
- `request_reschedule_history` — visit reschedules.
- `request_exec_assignments` — captain-driven reassignment trail, indexed for visibility lookups.

---

## Business logic that affects code

### Indian phone normalization
Always store/compare last 10 digits prefixed with `+91`. Strip country code variations, spaces, dashes. Used as dedup key for contacts via `lib/captain/contact-linker.ts`.

### IST timezone
India Standard Time (UTC+5:30). Hardcoded in `lib/date.ts` as `TIMEZONE = 'Asia/Kolkata'`. All `task_date`, `plan_date`, `postponed_to_date` columns are `DATE` type assumed to be IST. Convert from `TIMESTAMPTZ` columns using `AT TIME ZONE 'Asia/Kolkata'`.

### Day boundary
The "day" boundary for IST is midnight IST. The nightly cron runs at 21:31 IST (before midnight) intentionally — it processes "today" before today's data is locked.

### Money in paise
All monetary columns are `bigint('xxx_paise', { mode: 'number' })`. ₹100 = 10000 paise. Conversion to rupees only at display boundary via `lib/money.ts`.

### Captain approval gate (HVA-137)
Exec cannot move a request to ORDER_EXECUTED without captain approval. Status flow forces PENDING_CAPTAIN_APPROVAL between QUOTATION_SENT and ORDER_PLACED.

### City-scoping vs team-scoping
- Captain sees execs in their team (`sales_executives.captain_user_id = captain.user_id`), NOT execs in their cities. Cross-city teams exist.
- Contacts and requests are city-tagged for analytics but not access-controlled by city.

### Order Executed click-credit attribution (HVA-168)
When an order is executed, click-credit is attributed to the exec who captured the lead, not the exec who closed the order. Captain dashboard's Orders metric reflects this.

### Pending Approvals predicate (HVA-168)
Count of requests currently sitting in PENDING_CAPTAIN_APPROVAL status. NOT count of requests that ever entered that status. Historical mode uses `request_status_history` to find current status as of a past date.

### First-login pin (HVA-26, HVA-96)
- Seed prints temp password for super_admin.
- First sign-in flips `users.must_change_password` to false only after `/set-password` action.
- `proxy.ts` redirects to `/set-password` until the flag clears.

### Build-arg leakage prevention
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined at build time.
- `scripts/deploy.sh` greps `.next/static/**` after build to confirm the real key landed and no placeholder strings remain.
- Ship aborts if either check fails.

---

## What HVA is NOT

- NOT a customer-facing app. Customers don't have logins.
- NOT an e-commerce platform. That's beakn.in.
- NOT a CRM in the Salesforce sense — it's a field-ops app first, with CRM features layered on (HVA-73 contact-book shift).
- NOT a multi-tenant SaaS. Beakn-internal only.
- NOT a real-time collaboration tool. Single-actor mutations. Page reload on user's own action. No SSE.

---

## Source-of-truth docs (Notion)

The canonical product spec lives in Notion, not in this repo.

- **Master hub page id:** `35f48602-1431-811c-838d-ff8a91b36764`
- **Hub page (linked from master):** `35f48602-1431-80a2-94d3-f21672b30495`
- **v2 spec drafts:**
  - `35f48602-1431-80f0-9cf2-fc80ab2bebeb` — beakn-home-visit-app-spec-draft-v2 (§1–§20)
  - `35f48602-1431-8126-a063-ce460161b595` — second v2 draft (more recent)
- **UI/UX design v2:** `35f48602-1431-81b1-9b9b-f643d11e465c`
- **Exec summary:** `35e48602-1431-8078-a046-f79707ea9732`

When the user references a spec section (e.g. "per §5", "per HVA-XX"), fetch from these IDs directly. For a fresh discovery pass, search Notion for "Beakn Home Visit App."

---

## Linear

- **Team:** Home Visit App (id `6535136c-f3d8-46d0-9099-127fde4bccfe`)
- **Project:** Phase 1 — MVP Launch
- **Issue prefix:** HVA-NN
- **Status workflow:** Backlog → Todo → In Progress → In Review → Done (also: Duplicate, Canceled)
- **Branch naming:** Linear's `gitBranchName` field auto-suggests `sandypublic/hva-NN-<kebab-slug>`

---

## GitHub

- **Repo:** `inai-sandy/beakn-home-visit-app`
- **Base branch:** `main`
- **PR title format:** `HVA-NN: <description>` or `HVA-NN-FIXN: <description>` for follow-ups
- **Co-author tag in commits:** `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
